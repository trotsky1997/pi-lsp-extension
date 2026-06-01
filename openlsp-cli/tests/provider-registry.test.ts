import { expect, test } from "bun:test";
import { AdapterRegistry } from "../src/adapter-registry.ts";
import { ANALYZERS } from "../src/core/analyzer-core.ts";
import { FORMATTERS } from "../src/core/formatter-core.ts";
import { LSP_SERVERS } from "../src/core/lsp-core.ts";
import {
	ProviderRegistry,
	validateProviderManifest,
} from "../src/provider-registry.ts";

test("validateProviderManifest accepts command-backed providers", () => {
	expect(
		validateProviderManifest(
			{
				id: "custom-json-ls",
				kind: "lsp",
				runtime: "bun",
				command: "custom-json-ls",
				extensions: [".json"],
			},
			"test",
		),
	).toMatchObject({
		id: "custom-json-ls",
		kind: "lsp",
		capabilities: ["lsp"],
	});
});

test("validateProviderManifest reports provider id and invalid field path", () => {
	expect(() =>
		validateProviderManifest(
			{
				id: "bad-provider",
				kind: "analyzer",
				runtime: "bun",
				command: "bad-provider",
				parser: "unknown-parser",
			},
			"workspace",
		),
	).toThrow(/bad-provider.*workspace.*parser/);
});

test("ProviderRegistry exposes built-in manifests for all legacy providers and workspace providers", () => {
	const registry = new ProviderRegistry({
		providers: [
			{
				id: "custom-md-analyzer",
				kind: "analyzer",
				runtime: "bun",
				command: "custom-md-analyzer",
				extensions: [".md"],
				fileNames: [],
				capabilities: ["analyze"],
				parser: "plain",
			},
		],
	});

	const capabilities = registry.listCapabilities();
	expect(
		capabilities.some(
			(provider) =>
				provider.id === "json-ls" &&
				provider.kind === "lsp" &&
				provider.source === "built-in",
		),
	).toBe(true);
	expect(
		capabilities.some(
			(provider) =>
				provider.id === "typescript" &&
				provider.kind === "lsp" &&
				provider.source === "built-in" &&
				provider.handler === "legacy:lsp:typescript",
		),
	).toBe(true);
	expect(
		capabilities.some(
			(provider) =>
				provider.id === "custom-md-analyzer" &&
				provider.source === "workspace",
		),
	).toBe(true);
});

test("ProviderRegistry registers every legacy provider as a built-in manifest", () => {
	const capabilities = new ProviderRegistry().listCapabilities();
	const missingLsp = LSP_SERVERS.filter(
		(server) =>
			!capabilities.some(
				(provider) =>
					provider.kind === "lsp" &&
					provider.id === server.id &&
					provider.source === "built-in" &&
					provider.handler === `legacy:lsp:${server.id}`,
			),
	);
	const missingFormatters = FORMATTERS.filter(
		(formatter) =>
			!capabilities.some(
				(provider) =>
					provider.kind === "formatter" &&
					provider.id === formatter.id &&
					provider.source === "built-in" &&
					provider.handler === `legacy:formatter:${formatter.id}`,
			),
	);
	const missingAnalyzers = ANALYZERS.filter(
		(analyzer) =>
			!capabilities.some(
				(provider) =>
					provider.kind === "analyzer" &&
					provider.id === analyzer.id &&
					provider.source === "built-in" &&
					provider.handler === `legacy:analyzer:${analyzer.id}`,
			),
	);

	expect(missingLsp).toEqual([]);
	expect(missingFormatters).toEqual([]);
	expect(missingAnalyzers).toEqual([]);
});

test("ProviderRegistry treats adapters as provider-compatible entries", () => {
	const registry = new ProviderRegistry({
		adapters: [
			{
				id: "adapter-md-analyzer",
				kind: "analyzer",
				runtime: "bun",
				command: "adapter-md-analyzer",
				extensions: [".md"],
				fileNames: [],
				capabilities: ["analyze"],
			},
		],
	});

	expect(
		registry
			.listCapabilities()
			.some(
				(provider) =>
					provider.id === "adapter-md-analyzer" &&
					provider.source === "adapter-compat",
			),
	).toBe(true);
});

test("ProviderRegistry selection honors command preferences and availability", () => {
	const registry = new ProviderRegistry({
		providers: [
			{
				id: "workspace-prettier",
				kind: "formatter",
				runtime: "bun",
				command: "prettier",
				args: ["--write", "{file}"],
				extensions: [".ts"],
				fileNames: [],
				capabilities: ["format"],
			},
		],
	});

	expect(
		registry.selectProvider("formatter", "src/index.ts", "workspace-prettier")
			?.source,
	).toBe("workspace");
	expect(() =>
		registry.selectProvider("formatter", "src/index.ts", "missing-provider"),
	).toThrow(/missing-provider/);
});

test("AdapterRegistry capabilities are registry-backed", () => {
	const capabilities = new AdapterRegistry().listCapabilities({
		providers: [
			{
				id: "workspace-transport",
				kind: "transport",
				runtime: "bun",
				command: "openlsp-transport",
				extensions: [],
				fileNames: [],
				capabilities: ["transport"],
			},
		],
	});

	expect(
		capabilities.some(
			(provider) =>
				provider.id === "workspace-transport" &&
				provider.source === "workspace",
		),
	).toBe(true);
	expect(
		capabilities.some(
			(provider) => provider.id === "taplo" && provider.source === "built-in",
		),
	).toBe(true);
});
