import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CommandService, envelopeToText } from "./command-service.ts";

export type HookOutputFormat = "claude" | "codex" | "text" | "json";
export type HookCheck = "diagnostics" | "analyze" | "both";

export interface HookRunOptions {
	eventName?: string;
	cwd?: string;
	configPath?: string;
	timeoutMs?: number;
	maxFiles?: number;
	check?: HookCheck;
	outputFormat?: HookOutputFormat;
}

export interface HookRunResult {
	files: string[];
	eventName: string;
	hasFindings: boolean;
	message: string;
	checks: Array<{
		filePath: string;
		command: "diagnostics" | "analyze";
		status: "ok" | "error";
		text: string;
	}>;
}

const fileKeyPattern = /^(?:file|path|filePath|file_path|filepath|uri)$/i;
const supportedSourceExtensions = new Set([
	".astro",
	".bash",
	".bib",
	".c",
	".cc",
	".cjs",
	".clj",
	".cljs",
	".cljc",
	".cpp",
	".cs",
	".css",
	".cts",
	".dart",
	".edn",
	".erb",
	".ex",
	".exs",
	".fs",
	".fsx",
	".gleam",
	".go",
	".h",
	".hh",
	".hpp",
	".hs",
	".html",
	".java",
	".jl",
	".js",
	".jsx",
	".json",
	".jsonc",
	".kt",
	".kts",
	".lhs",
	".lua",
	".md",
	".mdx",
	".mjs",
	".ml",
	".mli",
	".mts",
	".nix",
	".php",
	".prisma",
	".ps1",
	".psd1",
	".psm1",
	".py",
	".pyi",
	".rb",
	".rs",
	".svelte",
	".swift",
	".tex",
	".tf",
	".tfvars",
	".toml",
	".ts",
	".tsx",
	".typ",
	".vue",
	".yaml",
	".yml",
	".zig",
	".zsh",
]);

function maybeFileUriToPath(value: string): string {
	if (!value.startsWith("file://")) return value;
	return fileURLToPath(value);
}

function cleanCandidatePath(value: string): string {
	return value.trim().replace(/^["']|["']$/g, "");
}

function looksLikeSourceFile(value: string): boolean {
	const ext = path.extname(value).toLowerCase();
	return supportedSourceExtensions.has(ext);
}

export function collectPatchCommandPaths(command: string): string[] {
	const paths: string[] = [];
	const patchPathPattern =
		/^\*\*\* (?:Add File|Update File|Delete File|Move to):\s+(.+?)\s*$/gm;
	for (const match of command.matchAll(patchPathPattern)) {
		const candidate = cleanCandidatePath(match[1] ?? "");
		if (candidate) paths.push(candidate);
	}
	return paths;
}

function collectCandidatePaths(value: unknown, paths: string[] = []): string[] {
	if (!value) return paths;
	if (typeof value === "string") {
		if (looksLikeSourceFile(maybeFileUriToPath(value))) {
			paths.push(maybeFileUriToPath(value));
		}
		return paths;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectCandidatePaths(item, paths);
		return paths;
	}
	if (typeof value !== "object") return paths;

	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (key === "command" && typeof nested === "string") {
			paths.push(...collectPatchCommandPaths(nested));
		}
		if (typeof nested === "string" && fileKeyPattern.test(key)) {
			paths.push(maybeFileUriToPath(nested));
			continue;
		}
		collectCandidatePaths(nested, paths);
	}
	return paths;
}

function inferEventName(input: unknown, explicitEventName?: string): string {
	if (explicitEventName) return explicitEventName;
	if (input && typeof input === "object") {
		const data = input as Record<string, unknown>;
		if (typeof data.hook_event_name === "string" && data.hook_event_name) {
			return data.hook_event_name;
		}
	}
	return "PostToolUse";
}

export function resolveHookFiles(input: unknown, cwd: string, maxFiles = 8): string[] {
	const seen = new Set<string>();
	const resolved: string[] = [];
	for (const candidate of collectCandidatePaths(input)) {
		const cleanCandidate = maybeFileUriToPath(cleanCandidatePath(candidate));
		const absPath = path.isAbsolute(cleanCandidate)
			? cleanCandidate
			: path.resolve(cwd, cleanCandidate);
		if (!looksLikeSourceFile(absPath)) continue;
		if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) continue;
		const key = path.normalize(absPath).toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		resolved.push(absPath);
		if (resolved.length >= maxFiles) break;
	}
	return resolved;
}

function inferCwd(input: unknown, explicitCwd?: string): string {
	if (explicitCwd) return path.resolve(explicitCwd);
	if (input && typeof input === "object") {
		const data = input as Record<string, unknown>;
		for (const key of ["cwd", "project_dir", "projectDir", "workspaceRoot"]) {
			if (typeof data[key] === "string") return path.resolve(data[key]);
		}
	}
	return path.resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
}

function isEmptyResultText(text: string): boolean {
	const normalized = text.trim().toLowerCase();
	return (
		!normalized ||
		normalized === "no diagnostics." ||
		normalized === "no analyzer findings." ||
		normalized.startsWith("unsupported:") ||
		normalized.startsWith("analyzer skipped:") ||
		normalized.includes("no lsp for ") ||
		normalized.includes("no lsp server or tree-sitter fallback available")
	);
}

export function hookResultHasFindings(result: HookRunResult): boolean {
	return result.checks.some((item) => !isEmptyResultText(item.text));
}

function formatHookMessage(result: HookRunResult): string {
	if (result.files.length === 0) {
		return "OpenLSP hook: no changed source files found in the hook event.";
	}
	const nonEmpty = result.checks.filter((item) => !isEmptyResultText(item.text));
	if (nonEmpty.length === 0) {
		return `OpenLSP checked ${result.files.length} file(s): no diagnostics or analyzer findings.`;
	}
	const lines = [`OpenLSP found issues in ${nonEmpty.length} check(s):`];
	for (const item of nonEmpty) {
		lines.push(
			`[${item.command}] ${path.basename(item.filePath)} (${item.status})`,
			item.text,
		);
	}
	return lines.join("\n\n");
}

export function renderHookOutput(
	result: HookRunResult,
	eventName: string,
	format: HookOutputFormat,
): string {
	if (format === "json") return JSON.stringify(result);
	if (format === "text") return result.message;
	return JSON.stringify({
		hookSpecificOutput: {
			hookEventName: eventName,
			additionalContext: result.message,
		},
	});
}

export async function runOpenLspHook(
	input: unknown,
	options: HookRunOptions,
): Promise<HookRunResult> {
	const cwd = inferCwd(input, options.cwd);
	const eventName = inferEventName(input, options.eventName);
	const files = resolveHookFiles(input, cwd, options.maxFiles ?? 8);
	const service = new CommandService();
	const checks: HookRunResult["checks"] = [];
	const check = options.check ?? "diagnostics";

	for (const filePath of files) {
		const relativePath = path.relative(cwd, filePath) || filePath;
		if (check === "diagnostics" || check === "both") {
			const envelope = await service.execute({
				command: "lsp",
				operation: "diagnostics",
				filePath: relativePath,
				cwd,
				configPath: options.configPath,
				timeoutMs: options.timeoutMs ?? 3000,
			});
			checks.push({
				filePath,
				command: "diagnostics",
				status: envelope.status,
				text: envelopeToText(envelope),
			});
		}
		if (check === "analyze" || check === "both") {
			const envelope = await service.execute({
				command: "analyze",
				filePath: relativePath,
				cwd,
				configPath: options.configPath,
				timeoutMs: options.timeoutMs ?? 10000,
			});
			checks.push({
				filePath,
				command: "analyze",
				status: envelope.status,
				text: envelopeToText(envelope),
			});
		}
	}

	const result: HookRunResult = { files, eventName, hasFindings: false, checks, message: "" };
	result.hasFindings = hookResultHasFindings(result);
	result.message = formatHookMessage(result);
	return result;
}
