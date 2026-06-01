import * as path from "node:path";
import type {
	AnalyzerSettings,
	FormatterSettings,
	LSPServerSettings,
	ResolvedLSPSettings,
} from "./core/lsp-settings.ts";
import type { OpenLspConfig } from "./schemas.ts";

function normalizeRecord<T extends Record<string, unknown>>(
	value: unknown,
): Record<string, T> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, T>;
}

export function toLegacyResolvedLspSettings(
	cwd: string,
	config: OpenLspConfig,
): ResolvedLSPSettings {
	const lsp = config.lsp ?? {};
	const formatter = config.formatter ?? {};
	const analyzer = config.analyzer ?? {};

	return {
		projectSettingsPath: path.join(cwd, "openlsp.config.json"),
		globalSettingsPath: "inline://openlsp-cli",
		enabled: lsp.enabled ?? true,
		hookMode: (lsp.enabled ?? true) ? "agent_end" : "disabled",
		pythonProvider: lsp.pythonProvider ?? "pyright",
		servers: normalizeRecord<LSPServerSettings>(lsp.servers),
		formatterEnabled: formatter.enabled ?? true,
		formatterHookMode: (formatter.enabled ?? true) ? "write" : "disabled",
		formatters: normalizeRecord<FormatterSettings>(formatter.formatters),
		analyzerEnabled: analyzer.enabled ?? true,
		analyzerHookMode: (analyzer.enabled ?? true) ? "agent_end" : "disabled",
		analyzers: normalizeRecord<AnalyzerSettings>(analyzer.analyzers),
	};
}
