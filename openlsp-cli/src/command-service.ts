import * as path from "node:path";
import {
	getAnalyzerConfigsForFile,
	runAnalyzersForFile,
} from "./core/analyzer-core.ts";
import {
	getFormatterConfigsForFile,
	runFormatterForFile,
} from "./core/formatter-core.ts";
import {
	filterDiagnosticsBySeverity,
	formatDiagnostic,
} from "./core/lsp-core.ts";
import { setResolvedLspSettingsOverride } from "./core/lsp-settings.ts";
import {
	formatDocumentHighlightResult,
	formatDocumentSymbolResult,
	formatFindReferencesResult,
	formatFoldingRangeResult,
	formatGoToDefinitionResult,
	formatHoverResult,
	formatIncomingCallsResult,
	formatOutgoingCallsResult,
	formatPrepareCallHierarchyResult,
	formatWorkspaceSymbolResult,
} from "./core/lsp-tool-formatters.ts";
import { AdapterRegistry } from "./adapter-registry.ts";
import type { WorkspaceContext } from "./workspace-service.ts";
import { WorkspaceService } from "./workspace-service.ts";
import {
	PROTOCOL_VERSION,
	type CommandEnvelope,
	type CommandRequest,
	type OpenLspConfig,
	type Severity,
} from "./schemas.ts";
import { SessionService } from "./session-service.ts";
import { toLegacyResolvedLspSettings } from "./legacy-settings.ts";
import {
	formatCodeActions,
	formatSignature,
	formatWorkspaceEdit,
} from "./text-formatters.ts";

const DIAGNOSTICS_WAIT_MS_DEFAULT = 3000;

function diagnosticsWaitMsForFile(filePath: string): number {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".kt" || ext === ".kts") return 30000;
	if (ext === ".swift") return 20000;
	if (ext === ".rs") return 20000;
	return DIAGNOSTICS_WAIT_MS_DEFAULT;
}

function cloneConfig<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

export class CommandService {
	constructor(
		private readonly workspaceService = new WorkspaceService(),
		private readonly sessionService = new SessionService(),
		private readonly adapterRegistry = new AdapterRegistry(),
	) {}

	private buildMetadata(
		durationMs: number,
		extras: Record<string, unknown> = {},
	) {
		return {
			durationMs,
			warnings: [],
			...extras,
		};
	}

	private buildSuccessEnvelope(
		request: CommandRequest,
		workspace: WorkspaceContext,
		durationMs: number,
		data: unknown,
		extras: Record<string, unknown> = {},
		mode: "local" | "remote" = "local",
	): CommandEnvelope {
		return {
			protocolVersion: PROTOCOL_VERSION,
			status: "ok",
			runtime: "bun",
			mode,
			command: request.command,
			workspace: {
				cwd: workspace.cwd,
				root: workspace.root,
				configSources: workspace.resolvedConfig.sources,
			},
			session:
				"session" in extras
					? (extras.session as CommandEnvelope["session"])
					: undefined,
			metadata: this.buildMetadata(durationMs, extras),
			data,
		};
	}

	private buildErrorEnvelope(
		request: CommandRequest,
		workspace: WorkspaceContext | null,
		error: unknown,
		durationMs: number,
		mode: "local" | "remote" = "local",
		extras: Record<string, unknown> = {},
	): CommandEnvelope {
		const message = error instanceof Error ? error.message : String(error);
		return {
			protocolVersion: PROTOCOL_VERSION,
			status: "error",
			runtime: "bun",
			mode,
			command: request.command,
			workspace: {
				cwd: workspace?.cwd ?? path.resolve(request.cwd ?? process.cwd()),
				root:
					workspace?.root ??
					path.resolve(request.workspaceRoot ?? request.cwd ?? process.cwd()),
				configSources: workspace?.resolvedConfig.sources ?? ["defaults"],
			},
			session:
				"session" in extras
					? (extras.session as CommandEnvelope["session"])
					: undefined,
			metadata: this.buildMetadata(durationMs, extras),
			error: {
				code: "command_failed",
				message,
				retryable: false,
			},
		};
	}

	private buildEffectiveConfig(
		workspace: WorkspaceContext,
		request: CommandRequest,
	): OpenLspConfig {
		const config = cloneConfig(workspace.resolvedConfig.config);

		if (request.command === "format") {
			const requested = config.commands?.format?.formatter;
			if (requested) {
				config.formatter ??= { formatters: {} };
				config.formatter.formatters ??= {};
				for (const formatter of getFormatterConfigsForFile(
					request.filePath,
					workspace.root,
				)) {
					if (formatter.id === requested) continue;
					config.formatter.formatters[formatter.id] = {
						...(config.formatter.formatters[formatter.id] ?? {}),
						disabled: true,
					};
				}
			}
		}

		if (request.command === "analyze") {
			const requested = config.commands?.analyze?.analyzers ?? [];
			if (requested.length > 0) {
				config.analyzer ??= { analyzers: {} };
				config.analyzer.analyzers ??= {};
				for (const analyzer of getAnalyzerConfigsForFile(
					request.filePath,
					workspace.root,
				)) {
					if (requested.includes(analyzer.id)) continue;
					config.analyzer.analyzers[analyzer.id] = {
						...(config.analyzer.analyzers[analyzer.id] ?? {}),
						disabled: true,
					};
				}
			}
		}

		if (request.command === "lsp") {
			const requested = config.commands?.lsp?.lspServer;
			if (requested) {
				config.lsp ??= { servers: {} };
				config.lsp.servers ??= {};
				for (const capability of workspace.capabilities.filter(
					(item) => item.kind === "lsp",
				)) {
					if (capability.id === requested) continue;
					config.lsp.servers[capability.id] = {
						...(config.lsp.servers[capability.id] ?? {}),
						disabled: true,
					};
				}
			}
		}

		return config;
	}

	private async withLegacySettings<T>(
		workspaceRoot: string,
		config: OpenLspConfig,
		run: () => Promise<T>,
	): Promise<T> {
		setResolvedLspSettingsOverride(
			workspaceRoot,
			toLegacyResolvedLspSettings(workspaceRoot, config),
		);
		try {
			return await run();
		} finally {
			setResolvedLspSettingsOverride(workspaceRoot, undefined);
		}
	}

	private async ensureOpenFile(
		manager: any,
		filePath: string,
		cwd: string,
		operation: string,
	): Promise<string> {
		const absolutePath = path.isAbsolute(filePath)
			? filePath
			: path.resolve(cwd, filePath);
		const file = Bun.file(absolutePath);
		if (!(await file.exists())) {
			throw new Error(`File not found: ${absolutePath}`);
		}
		const content = await file.text();
		const opened = await manager.openFile(absolutePath, content);
		if (!opened) {
			const backend = await manager.getOperationBackend(absolutePath, operation);
			if (backend === "tree-sitter") return absolutePath;
			throw new Error(
				`No LSP server or tree-sitter fallback available for file type: ${path.extname(absolutePath) || "<unknown>"}`,
			);
		}
		return absolutePath;
	}

	private severityFilter(severity?: Severity): Severity {
		return severity ?? "all";
	}

	private formatWorkspaceDiagnostics(result: any, severity: Severity): string {
		const lines: string[] = [];
		let diagnosticsCount = 0;
		let filesWithIssues = 0;
		for (const item of result.items) {
			const display = item.file;
			if (item.status !== "ok") {
				lines.push(`${display}: ${item.error || item.status}`);
				continue;
			}
			const diagnostics = filterDiagnosticsBySeverity(
				item.diagnostics,
				severity,
			);
			if (!diagnostics.length) continue;
			filesWithIssues += 1;
			diagnosticsCount += diagnostics.length;
			lines.push(`${display}:`);
			for (const diagnostic of diagnostics) {
				lines.push(`  ${formatDiagnostic(diagnostic)}`);
			}
		}
		const summary = `Analyzed ${result.items.length} file(s), found ${diagnosticsCount} diagnostics in ${filesWithIssues} file(s).`;
		return lines.length
			? `${summary}\n\n${lines.join("\n")}`
			: `${summary}\n\nNo diagnostics.`;
	}

	private formatLspResult(
		operation: string,
		result: unknown,
		cwd: string,
	): string {
		switch (operation) {
			case "goToDefinition":
			case "goToImplementation":
			case "typeDefinition":
				return formatGoToDefinitionResult(result as any, cwd);
			case "findReferences":
				return formatFindReferencesResult((result as any) ?? [], cwd);
			case "hover":
				return formatHoverResult(result as any);
			case "documentHighlight":
				return formatDocumentHighlightResult((result as any) ?? []);
			case "documentSymbol":
				return formatDocumentSymbolResult((result as any) ?? [], cwd);
			case "workspaceSymbol":
				return formatWorkspaceSymbolResult((result as any) ?? [], cwd);
			case "prepareCallHierarchy":
				return formatPrepareCallHierarchyResult((result as any) ?? [], cwd);
			case "incomingCalls":
				return formatIncomingCallsResult((result as any) ?? [], cwd);
			case "outgoingCalls":
				return formatOutgoingCallsResult((result as any) ?? [], cwd);
			case "signatureHelp":
				return formatSignature(result as any);
			case "rename":
				return result
					? formatWorkspaceEdit(result as any, cwd)
					: "No rename available at this position.";
			case "prepareRename": {
				const value = result as {
					placeholder?: string;
					range: {
						start: { line: number; character: number };
						end: { line: number; character: number };
					};
				} | null;
				return value
					? `Rename available for ${value.range.start.line + 1}:${value.range.start.character + 1}-${value.range.end.line + 1}:${value.range.end.character + 1}${value.placeholder ? `\nPlaceholder: ${value.placeholder}` : ""}`
					: "Rename is not available at this position.";
			}
			case "foldingRange":
				return formatFoldingRangeResult((result as any) ?? []);
			case "codeAction":
				return formatCodeActions((result as any) ?? []);
			default:
				return typeof result === "string"
					? result
					: JSON.stringify(result, null, 2);
		}
	}

	private async executeLsp(
		request: Extract<CommandRequest, { command: "lsp" }>,
		workspace: WorkspaceContext,
		mode: "local" | "remote",
	): Promise<CommandEnvelope> {
		const startedAt = performance.now();
		const effectiveConfig = this.buildEffectiveConfig(workspace, request);
		const { session, reused } = this.sessionService.ensureSession(
			workspace.root,
			effectiveConfig,
			request.sessionId,
		);
		const extras = {
			session: { id: session.id, reused },
		};

		try {
			const manager = session.manager;
			if (request.operation === "diagnostics") {
				const backend =
					(await manager.getOperationBackend(
						request.filePath!,
						request.operation,
					)) ?? undefined;
				const result = await manager.touchFileAndWait(
					request.filePath!,
					request.timeoutMs ?? diagnosticsWaitMsForFile(request.filePath!),
				);
				const diagnostics = filterDiagnosticsBySeverity(
					result.diagnostics,
					this.severityFilter(request.severity),
				);
				const text = (
					result as {
						unsupported?: boolean;
						error?: string;
						receivedResponse: boolean;
					}
				).unsupported
					? `Unsupported: ${(result as { error?: string }).error || "No LSP for this file."}`
					: !result.receivedResponse
						? "Timeout: LSP server did not respond. Try again."
						: diagnostics.length
							? diagnostics.map(formatDiagnostic).join("\n")
							: "No diagnostics.";
				return this.buildSuccessEnvelope(
					request,
					workspace,
					performance.now() - startedAt,
					{ text, diagnostics },
					{ ...extras, backend, resultCount: diagnostics.length },
					mode,
				);
			}

			if (request.operation === "workspaceDiagnostics") {
				const waitMs = Math.max(
					...(request.filePaths ?? []).map((filePath: string) =>
						diagnosticsWaitMsForFile(filePath),
					),
					DIAGNOSTICS_WAIT_MS_DEFAULT,
				);
				const result = await manager.getDiagnosticsForFiles(
					request.filePaths!,
					request.timeoutMs ?? waitMs,
				);
				const text = this.formatWorkspaceDiagnostics(
					result,
					this.severityFilter(request.severity),
				);
				return this.buildSuccessEnvelope(
					request,
					workspace,
					performance.now() - startedAt,
					{ text, result },
					extras,
					mode,
				);
			}

			const absolutePath = await this.ensureOpenFile(
				manager,
				request.filePath!,
				workspace.root,
				request.operation,
			);
			const backend =
				(await manager.getOperationBackend(absolutePath, request.operation)) ??
				undefined;
			let result: unknown;

			switch (request.operation) {
				case "goToDefinition":
					result = await manager.getDefinition(
						absolutePath,
						request.line!,
						request.character!,
					);
					break;
				case "findReferences":
					result = await manager.getReferences(
						absolutePath,
						request.line!,
						request.character!,
					);
					break;
				case "hover":
					result = await manager.getHover(
						absolutePath,
						request.line!,
						request.character!,
					);
					break;
				case "documentHighlight":
					result = await manager.getDocumentHighlights(
						absolutePath,
						request.line!,
						request.character!,
					);
					break;
				case "documentSymbol":
					result = await manager.getDocumentSymbols(absolutePath);
					break;
				case "workspaceSymbol":
					result = await manager.getWorkspaceSymbols(absolutePath);
					break;
				case "goToImplementation":
					result = await manager.getImplementation(
						absolutePath,
						request.line!,
						request.character!,
					);
					break;
				case "typeDefinition":
					result = await manager.getTypeDefinition(
						absolutePath,
						request.line!,
						request.character!,
					);
					break;
				case "prepareCallHierarchy":
					result = await manager.prepareCallHierarchy(
						absolutePath,
						request.line!,
						request.character!,
					);
					break;
				case "incomingCalls": {
					const items = await manager.prepareCallHierarchy(
						absolutePath,
						request.line!,
						request.character!,
					);
					result = items.length ? await manager.getIncomingCalls(items[0]) : [];
					break;
				}
				case "outgoingCalls": {
					const items = await manager.prepareCallHierarchy(
						absolutePath,
						request.line!,
						request.character!,
					);
					result = items.length ? await manager.getOutgoingCalls(items[0]) : [];
					break;
				}
				case "signatureHelp":
					result = await manager.getSignatureHelp(
						absolutePath,
						request.line!,
						request.character!,
					);
					break;
				case "rename":
					result = await manager.rename(
						absolutePath,
						request.line!,
						request.character!,
						request.newName!,
					);
					break;
				case "prepareRename":
					result = await manager.prepareRename(
						absolutePath,
						request.line!,
						request.character!,
					);
					break;
				case "foldingRange":
					result = await manager.getFoldingRanges(absolutePath);
					break;
				case "codeAction":
					result = await manager.getCodeActions(
						absolutePath,
						request.line!,
						request.character!,
						request.endLine,
						request.endCharacter,
					);
					break;
			}

			const text = this.formatLspResult(
				request.operation,
				result,
				workspace.root,
			);
			return this.buildSuccessEnvelope(
				request,
				workspace,
				performance.now() - startedAt,
				{ text, result },
				{ ...extras, backend },
				mode,
			);
		} catch (error) {
			return this.buildErrorEnvelope(
				request,
				workspace,
				error,
				performance.now() - startedAt,
				mode,
				extras,
			);
		}
	}

	private async executeFormat(
		request: Extract<CommandRequest, { command: "format" }>,
		workspace: WorkspaceContext,
		mode: "local" | "remote",
	): Promise<CommandEnvelope> {
		const startedAt = performance.now();
		const effectiveConfig = this.buildEffectiveConfig(workspace, request);

		try {
			const absolutePath = path.resolve(workspace.root, request.filePath);
			const selection = await this.withLegacySettings(
				workspace.root,
				effectiveConfig,
				async () => {
					const availableFormatterIds = getFormatterConfigsForFile(
						absolutePath,
						workspace.root,
					).map((formatter) => formatter.id);
					return this.adapterRegistry.resolveFormatter(
						effectiveConfig,
						absolutePath,
						availableFormatterIds,
					);
				},
			);

			if (!selection) {
				throw new Error(
					`No formatter adapter is available for ${request.filePath}`,
				);
			}

			if (selection.source === "custom" && selection.manifest) {
				const result = await this.adapterRegistry.runCustomAdapter(
					selection.manifest,
					absolutePath,
					workspace.root,
					request.timeoutMs,
				);
				if (result.code !== 0) {
					throw new Error(
						result.stderr || `Custom formatter exited with code ${result.code}`,
					);
				}
				const text =
					result.stdout.trim() ||
					`Custom formatter ${selection.adapterId} completed.`;
				return this.buildSuccessEnvelope(
					request,
					workspace,
					performance.now() - startedAt,
					{ text },
					{ adapterId: selection.adapterId, adapterIds: [selection.adapterId] },
					mode,
				);
			}

			const result = await this.withLegacySettings(
				workspace.root,
				effectiveConfig,
				async () => await runFormatterForFile(absolutePath, workspace.root),
			);
			if (result.error) throw new Error(result.error);
			const text = result.skipped
				? `Formatter skipped: ${result.skipped}`
				: result.changed
					? `Formatted ${request.filePath} with ${result.formatterId}.`
					: `No formatting changes for ${request.filePath}.`;
			return this.buildSuccessEnvelope(
				request,
				workspace,
				performance.now() - startedAt,
				{ text, result },
				{
					adapterId: result.formatterId,
					adapterIds: result.formatterId ? [result.formatterId] : undefined,
				},
				mode,
			);
		} catch (error) {
			return this.buildErrorEnvelope(
				request,
				workspace,
				error,
				performance.now() - startedAt,
				mode,
			);
		}
	}

	private async executeAnalyze(
		request: Extract<CommandRequest, { command: "analyze" }>,
		workspace: WorkspaceContext,
		mode: "local" | "remote",
	): Promise<CommandEnvelope> {
		const startedAt = performance.now();
		const effectiveConfig = this.buildEffectiveConfig(workspace, request);

		try {
			const absolutePath = path.resolve(workspace.root, request.filePath);
			const selection = await this.withLegacySettings(
				workspace.root,
				effectiveConfig,
				async () => {
					const availableAnalyzerIds = getAnalyzerConfigsForFile(
						absolutePath,
						workspace.root,
					).map((analyzer) => analyzer.id);
					return this.adapterRegistry.resolveAnalyzers(
						effectiveConfig,
						absolutePath,
						availableAnalyzerIds,
					);
				},
			);

			const customSelections = selection.filter(
				(entry) => entry.source === "custom",
			);
			if (customSelections.length > 0) {
				const outputs = [];
				for (const item of customSelections) {
					const result = await this.adapterRegistry.runCustomAdapter(
						item.manifest!,
						absolutePath,
						workspace.root,
						request.timeoutMs,
					);
					if (result.code !== 0) {
						throw new Error(
							result.stderr ||
								`Custom analyzer exited with code ${result.code}`,
						);
					}
					outputs.push(`${item.adapterId}: ${result.stdout.trim() || "ok"}`);
				}
				return this.buildSuccessEnvelope(
					request,
					workspace,
					performance.now() - startedAt,
					{ text: outputs.join("\n"), outputs },
					{ adapterIds: selection.map((entry) => entry.adapterId) },
					mode,
				);
			}

			const result = await this.withLegacySettings(
				workspace.root,
				effectiveConfig,
				async () => await runAnalyzersForFile(absolutePath, workspace.root),
			);
			if (
				result.error &&
				result.findings.length === 0 &&
				!result.notes?.length
			) {
				throw new Error(result.error);
			}

			const textLines: string[] = [];
			for (const finding of result.findings) {
				textLines.push(
					`${finding.severity.toUpperCase()} [${finding.line}:${finding.column}] ${finding.message}${finding.ruleId ? ` (${finding.ruleId})` : ""}`,
				);
			}
			for (const note of result.notes ?? []) {
				textLines.push(`INFO ${note.message}`);
			}
			if (textLines.length === 0) {
				textLines.push(
					result.skipped
						? `Analyzer skipped: ${result.skipped}`
						: "No analyzer findings.",
				);
			}

			return this.buildSuccessEnvelope(
				request,
				workspace,
				performance.now() - startedAt,
				{ text: textLines.join("\n"), result },
				{ adapterIds: result.analyzerIds },
				mode,
			);
		} catch (error) {
			return this.buildErrorEnvelope(
				request,
				workspace,
				error,
				performance.now() - startedAt,
				mode,
			);
		}
	}

	private executeConfig(
		request: Extract<CommandRequest, { command: "config" }>,
		workspace: WorkspaceContext,
		mode: "local" | "remote",
	): CommandEnvelope {
		const startedAt = performance.now();
		const text = [
			`Workspace root: ${workspace.root}`,
			`Config sources: ${workspace.resolvedConfig.sources.join(", ")}`,
			JSON.stringify(workspace.resolvedConfig.config, null, 2),
		].join("\n\n");
		return this.buildSuccessEnvelope(
			request,
			workspace,
			performance.now() - startedAt,
			{ text, config: workspace.resolvedConfig.config },
			{},
			mode,
		);
	}

	private executeCapabilities(
		request: Extract<CommandRequest, { command: "capabilities" }>,
		workspace: WorkspaceContext,
		mode: "local" | "remote",
	): CommandEnvelope {
		const startedAt = performance.now();
		const grouped = workspace.capabilities.reduce<Record<string, string[]>>(
			(acc, capability) => {
				const key = `${capability.kind}:${capability.source}`;
				acc[key] ??= [];
				acc[key].push(capability.id);
				return acc;
			},
			{},
		);
		const text = Object.entries(grouped)
			.map(([group, ids]) => `${group} -> ${ids.sort().join(", ")}`)
			.join("\n");
		return this.buildSuccessEnvelope(
			request,
			workspace,
			performance.now() - startedAt,
			{ text, capabilities: workspace.capabilities },
			{},
			mode,
		);
	}

	private async executeCloseSession(
		request: Extract<CommandRequest, { command: "session.close" }>,
		workspace: WorkspaceContext,
		mode: "local" | "remote",
	): Promise<CommandEnvelope> {
		const startedAt = performance.now();
		const closed = await this.sessionService.closeSession(request.sessionId);
		return this.buildSuccessEnvelope(
			request,
			workspace,
			performance.now() - startedAt,
			{
				text: closed
					? `Closed session ${request.sessionId}.`
					: `Session ${request.sessionId} was not active.`,
			},
			{ session: { id: request.sessionId, reused: false } },
			mode,
		);
	}

	async execute(
		request: CommandRequest,
		mode: "local" | "remote" = "local",
	): Promise<CommandEnvelope> {
		const workspace = await this.workspaceService.resolve(request);

		switch (request.command) {
			case "lsp":
				return await this.executeLsp(request, workspace, mode);
			case "format":
				return await this.executeFormat(request, workspace, mode);
			case "analyze":
				return await this.executeAnalyze(request, workspace, mode);
			case "config":
				return this.executeConfig(request, workspace, mode);
			case "capabilities":
				return this.executeCapabilities(request, workspace, mode);
			case "session.close":
				return await this.executeCloseSession(request, workspace, mode);
		}
	}
}

export function envelopeToText(envelope: CommandEnvelope): string {
	if (envelope.status === "error") {
		return `${envelope.error.code}: ${envelope.error.message}`;
	}
	if (
		envelope.data &&
		typeof envelope.data === "object" &&
		envelope.data !== null &&
		"text" in envelope.data
	) {
		return String((envelope.data as { text?: unknown }).text ?? "");
	}
	return JSON.stringify(envelope.data, null, 2);
}
