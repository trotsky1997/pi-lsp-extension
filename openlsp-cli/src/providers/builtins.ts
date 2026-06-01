import { ANALYZERS } from "../core/analyzer-core.ts";
import { FORMATTERS } from "../core/formatter-core.ts";
import { LSP_SERVERS } from "../core/lsp-core.ts";
import type { ProviderManifest } from "../schemas.ts";

function lspProvider(server: (typeof LSP_SERVERS)[number]): ProviderManifest {
	return {
		id: server.id,
		kind: "lsp",
		runtime: "handler",
		handler: `legacy:lsp:${server.id}`,
		extensions: [...server.extensions],
		fileNames: [],
		capabilities: ["lsp"],
	};
}

function formatterProvider(
	formatter: (typeof FORMATTERS)[number],
): ProviderManifest {
	return {
		id: formatter.id,
		kind: "formatter",
		runtime: "handler",
		handler: `legacy:formatter:${formatter.id}`,
		extensions: [...formatter.extensions],
		fileNames: [],
		rootMarkers: formatter.rootMarkers ? [...formatter.rootMarkers] : undefined,
		capabilities: ["format"],
	};
}

function analyzerProvider(analyzer: (typeof ANALYZERS)[number]): ProviderManifest {
	return {
		id: analyzer.id,
		kind: "analyzer",
		runtime: "handler",
		handler: `legacy:analyzer:${analyzer.id}`,
		extensions: [...analyzer.extensions],
		fileNames: analyzer.fileNames ? [...analyzer.fileNames] : [],
		rootMarkers: analyzer.rootMarkers ? [...analyzer.rootMarkers] : undefined,
		capabilities: ["analyze"],
	};
}

export const BUILTIN_PROVIDER_MANIFESTS: ProviderManifest[] = [
	...LSP_SERVERS.map(lspProvider),
	...FORMATTERS.map(formatterProvider),
	...ANALYZERS.map(analyzerProvider),
];
