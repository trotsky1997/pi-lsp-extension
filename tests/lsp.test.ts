/**
 * Tests for LSP hook - configuration and utility functions
 *
 * Run with: npm test
 *
 * These tests cover:
 * - Project root detection for various languages
 * - Language ID mappings
 * - URI construction
 * - Server configuration correctness
 */

import { chmod, mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import {
	ANALYZERS,
	getAnalyzerConfigsForFile,
	runAnalyzersForFile,
} from "../analyzer-core.js";
import { FORMATTERS, getFormatterConfigsForFile } from "../formatter-core.js";
import { LSPManager, LSP_SERVERS, LANGUAGE_IDS } from "../lsp-core.js";
import { loadResolvedLspSettings } from "../lsp-settings.js";
import { resolveLspUiState } from "../lsp.js";
import {
	extractDevDocsSymbolAtPosition,
	findBestDevDocsEntry,
	resetDevDocsCache,
	selectDevDocsDocsets,
} from "../devdocs-core.js";
import { TreeSitterManager } from "../tree-sitter-wasm-core.js";

// ============================================================================
// Test utilities
// ============================================================================

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
}

const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

function test(name: string, fn: () => Promise<void>) {
	tests.push({ name, fn });
}

function assert(condition: boolean, message: string) {
	if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message: string) {
	assert(
		actual === expected,
		`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`,
	);
}

function assertIncludes(arr: string[], item: string, message: string) {
	assert(
		arr.includes(item),
		`${message}\nArray: [${arr.join(", ")}]\nMissing: ${item}`,
	);
}

/** Create a temp directory with optional file structure */
async function withTempDir(
	structure: Record<string, string | null>, // null = directory, string = file content
	fn: (dir: string) => Promise<void>,
): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "lsp-test-"));
	try {
		for (const [path, content] of Object.entries(structure)) {
			const fullPath = join(dir, path);
			if (content === null) {
				await mkdir(fullPath, { recursive: true });
			} else {
				await mkdir(join(dir, path.split("/").slice(0, -1).join("/")), {
					recursive: true,
				}).catch(() => {});
				await writeFile(fullPath, content);
			}
		}
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

// ============================================================================
// Language ID tests
// ============================================================================

test("LANGUAGE_IDS: TypeScript extensions", async () => {
	assertEquals(
		LANGUAGE_IDS[".ts"],
		"typescript",
		".ts should map to typescript",
	);
	assertEquals(
		LANGUAGE_IDS[".tsx"],
		"typescriptreact",
		".tsx should map to typescriptreact",
	);
	assertEquals(
		LANGUAGE_IDS[".mts"],
		"typescript",
		".mts should map to typescript",
	);
	assertEquals(
		LANGUAGE_IDS[".cts"],
		"typescript",
		".cts should map to typescript",
	);
});

test("LANGUAGE_IDS: JavaScript extensions", async () => {
	assertEquals(
		LANGUAGE_IDS[".js"],
		"javascript",
		".js should map to javascript",
	);
	assertEquals(
		LANGUAGE_IDS[".jsx"],
		"javascriptreact",
		".jsx should map to javascriptreact",
	);
	assertEquals(
		LANGUAGE_IDS[".mjs"],
		"javascript",
		".mjs should map to javascript",
	);
	assertEquals(
		LANGUAGE_IDS[".cjs"],
		"javascript",
		".cjs should map to javascript",
	);
});

test("LANGUAGE_IDS: JSON / TOML / PowerShell extensions", async () => {
	assertEquals(LANGUAGE_IDS[".json"], "json", ".json should map to json");
	assertEquals(LANGUAGE_IDS[".jsonc"], "jsonc", ".jsonc should map to jsonc");
	assertEquals(LANGUAGE_IDS[".toml"], "toml", ".toml should map to toml");
	assertEquals(
		LANGUAGE_IDS[".ps1"],
		"powershell",
		".ps1 should map to powershell",
	);
	assertEquals(
		LANGUAGE_IDS[".psm1"],
		"powershell",
		".psm1 should map to powershell",
	);
	assertEquals(
		LANGUAGE_IDS[".psd1"],
		"powershell",
		".psd1 should map to powershell",
	);
});

test("LANGUAGE_IDS: Dart extension", async () => {
	assertEquals(LANGUAGE_IDS[".dart"], "dart", ".dart should map to dart");
});

test("LANGUAGE_IDS: Go extension", async () => {
	assertEquals(LANGUAGE_IDS[".go"], "go", ".go should map to go");
});

test("LANGUAGE_IDS: Rust extension", async () => {
	assertEquals(LANGUAGE_IDS[".rs"], "rust", ".rs should map to rust");
});

test("LANGUAGE_IDS: Kotlin extensions", async () => {
	assertEquals(LANGUAGE_IDS[".kt"], "kotlin", ".kt should map to kotlin");
	assertEquals(LANGUAGE_IDS[".kts"], "kotlin", ".kts should map to kotlin");
});

test("LANGUAGE_IDS: Swift extension", async () => {
	assertEquals(LANGUAGE_IDS[".swift"], "swift", ".swift should map to swift");
});

test("LANGUAGE_IDS: Python extensions", async () => {
	assertEquals(LANGUAGE_IDS[".py"], "python", ".py should map to python");
	assertEquals(LANGUAGE_IDS[".pyi"], "python", ".pyi should map to python");
});

test("LANGUAGE_IDS: Vue/Svelte/Astro extensions", async () => {
	assertEquals(LANGUAGE_IDS[".vue"], "vue", ".vue should map to vue");
	assertEquals(
		LANGUAGE_IDS[".svelte"],
		"svelte",
		".svelte should map to svelte",
	);
	assertEquals(LANGUAGE_IDS[".astro"], "astro", ".astro should map to astro");
});

test("LANGUAGE_IDS: Markdown extensions", async () => {
	assertEquals(LANGUAGE_IDS[".md"], "markdown", ".md should map to markdown");
	assertEquals(LANGUAGE_IDS[".mdx"], "mdx", ".mdx should map to mdx");
});

test("LANGUAGE_IDS: LaTeX extensions", async () => {
	assertEquals(LANGUAGE_IDS[".tex"], "latex", ".tex should map to latex");
	assertEquals(LANGUAGE_IDS[".bib"], "bibtex", ".bib should map to bibtex");
	assertEquals(LANGUAGE_IDS[".sty"], "latex", ".sty should map to latex");
});

// ============================================================================
// Server configuration tests
// ============================================================================

test("LSP_SERVERS: has TypeScript server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "typescript");
	assert(server !== undefined, "Should have typescript server");
	assertIncludes(server!.extensions, ".ts", "Should handle .ts");
	assertIncludes(server!.extensions, ".tsx", "Should handle .tsx");
	assertIncludes(server!.extensions, ".js", "Should handle .js");
	assertIncludes(server!.extensions, ".jsx", "Should handle .jsx");
});

test("LSP_SERVERS: has Dart server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "dart");
	assert(server !== undefined, "Should have dart server");
	assertIncludes(server!.extensions, ".dart", "Should handle .dart");
});

test("LSP_SERVERS: has Rust Analyzer server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "rust-analyzer");
	assert(server !== undefined, "Should have rust-analyzer server");
	assertIncludes(server!.extensions, ".rs", "Should handle .rs");
});

test("LSP_SERVERS: has Gopls server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "gopls");
	assert(server !== undefined, "Should have gopls server");
	assertIncludes(server!.extensions, ".go", "Should handle .go");
});

test("LSP_SERVERS: has Kotlin server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "kotlin");
	assert(server !== undefined, "Should have kotlin server");
	assertIncludes(server!.extensions, ".kt", "Should handle .kt");
	assertIncludes(server!.extensions, ".kts", "Should handle .kts");
});

test("LSP_SERVERS: has Swift server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "swift");
	assert(server !== undefined, "Should have swift server");
	assertIncludes(server!.extensions, ".swift", "Should handle .swift");
});

test("LSP_SERVERS: has JSON server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "json-ls");
	assert(server !== undefined, "Should have json-ls server");
	assertIncludes(server!.extensions, ".json", "Should handle .json");
	assertIncludes(server!.extensions, ".jsonc", "Should handle .jsonc");
});

test("LSP_SERVERS: has Taplo server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "taplo");
	assert(server !== undefined, "Should have taplo server");
	assertIncludes(server!.extensions, ".toml", "Should handle .toml");
});

test("LSP_SERVERS: has PowerShell server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "powershell");
	assert(server !== undefined, "Should have powershell server");
	assertIncludes(server!.extensions, ".ps1", "Should handle .ps1");
	assertIncludes(server!.extensions, ".psm1", "Should handle .psm1");
	assertIncludes(server!.extensions, ".psd1", "Should handle .psd1");
});

test("LSP_SERVERS: has Pyright server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "pyright");
	assert(server !== undefined, "Should have pyright server");
	assertIncludes(server!.extensions, ".py", "Should handle .py");
	assertIncludes(server!.extensions, ".pyi", "Should handle .pyi");
});

test("LSP_SERVERS: has BasedPyright server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "basedpyright");
	assert(server !== undefined, "Should have basedpyright server");
	assertIncludes(server!.extensions, ".py", "Should handle .py");
	assertIncludes(server!.extensions, ".pyi", "Should handle .pyi");
});

test("LSP_SERVERS: has Ty server", async () => {
	const server = LSP_SERVERS.find((s) => s.id === "ty");
	assert(server !== undefined, "Should have ty server");
	assertIncludes(server!.extensions, ".py", "Should handle .py");
	assertIncludes(server!.extensions, ".pyi", "Should handle .pyi");
});

test("LSP_SERVERS: includes opencode-style built-ins", async () => {
	const ids = [
		"astro",
		"bash",
		"clangd",
		"deno",
		"eslint",
		"json-ls",
		"lua-ls",
		"markdown",
		"texlab",
		"nixd",
		"php",
		"powershell",
		"prisma",
		"taplo",
		"terraform",
		"tinymist",
		"yaml-ls",
		"zls",
	];
	for (const id of ids) {
		assert(
			LSP_SERVERS.some((server) => server.id === id),
			`Should have ${id} server`,
		);
	}
});

test("FORMATTERS: includes opencode-style built-ins", async () => {
	const ids = [
		"biome",
		"prettier",
		"rumdl",
		"ruff",
		"gofmt",
		"rustfmt",
		"shfmt",
		"terraform",
		"ktlint",
		"mix",
		"nixfmt",
		"zig",
	];
	for (const id of ids) {
		assert(
			FORMATTERS.some((formatter) => formatter.id === id),
			`Should have ${id} formatter`,
		);
	}
});

test("ANALYZERS: includes semgrep", async () => {
	assert(
		ANALYZERS.some((analyzer) => analyzer.id === "semgrep"),
		"Should have semgrep analyzer",
	);
});

test("ANALYZERS: includes common linter-style analyzers", async () => {
	const ids = [
		"ruff-check",
		"golangci-lint",
		"markdownlint",
		"lychee",
		"shellcheck",
		"hadolint",
		"slopgrep",
		"zippy",
		"sloppylint",
		"karpeslop",
	];
	for (const id of ids) {
		assert(
			ANALYZERS.some((analyzer) => analyzer.id === id),
			`Should have ${id} analyzer`,
		);
	}
});

test("markdown: uses workspace root", async () => {
	await withTempDir(
		{
			"docs/guide.md": "# Guide",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "markdown")!;
			const root = server.findRoot(join(dir, "docs/guide.md"), dir, {});
			assertEquals(root, dir, "Markdown should use workspace root");
		},
	);
});

test("markdown: prefers moxide marker root", async () => {
	await withTempDir(
		{
			"vault/.moxide.toml": "",
			"vault/docs/guide.md": "# Guide",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "markdown")!;
			const root = server.findRoot(join(dir, "vault/docs/guide.md"), dir, {});
			assertEquals(
				root,
				join(dir, "vault"),
				"Markdown should use .moxide.toml root when present",
			);
		},
	);
});

test("json-ls: uses workspace root for standalone json files", async () => {
	await withTempDir(
		{
			"config/app.json": "{}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "json-ls")!;
			const root = server.findRoot(join(dir, "config/app.json"), dir, {});
			assertEquals(root, dir, "JSON should fall back to workspace root");
		},
	);
});

test("taplo: finds root with taplo.toml", async () => {
	await withTempDir(
		{
			"workspace/taplo.toml": "",
			"workspace/config/settings.toml": "title = 'demo'\n",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "taplo")!;
			const root = server.findRoot(
				join(dir, "workspace/config/settings.toml"),
				dir,
				{},
			);
			assertEquals(
				root,
				join(dir, "workspace"),
				"Taplo should find root at taplo.toml location",
			);
		},
	);
});

test("powershell: finds root with PSScriptAnalyzerSettings.psd1", async () => {
	await withTempDir(
		{
			"scripts/PSScriptAnalyzerSettings.psd1": "@{}\n",
			"scripts/tools/profile.ps1": "Write-Host 'hi'\n",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "powershell")!;
			const root = server.findRoot(
				join(dir, "scripts/tools/profile.ps1"),
				dir,
				{},
			);
			assertEquals(
				root,
				join(dir, "scripts"),
				"PowerShell should find root at PSScriptAnalyzerSettings.psd1 location",
			);
		},
	);
});

test("texlab: finds root with texlabroot marker", async () => {
	await withTempDir(
		{
			"paper/texlabroot": "",
			"paper/main.tex": "\\documentclass{article}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "texlab")!;
			const root = server.findRoot(join(dir, "paper/main.tex"), dir, {});
			assertEquals(
				root,
				join(dir, "paper"),
				"texlab should use texlabroot when present",
			);
		},
	);
});

// ============================================================================
// TypeScript root detection tests
// ============================================================================

test("typescript: finds root with package.json", async () => {
	await withTempDir(
		{
			"package.json": "{}",
			"src/index.ts": "export const x = 1;",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const root = server.findRoot(join(dir, "src/index.ts"), dir, {});
			assertEquals(root, dir, "Should find root at package.json location");
		},
	);
});

test("typescript: finds root with tsconfig.json", async () => {
	await withTempDir(
		{
			"tsconfig.json": "{}",
			"src/index.ts": "export const x = 1;",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const root = server.findRoot(join(dir, "src/index.ts"), dir, {});
			assertEquals(root, dir, "Should find root at tsconfig.json location");
		},
	);
});

test("typescript: finds root with jsconfig.json", async () => {
	await withTempDir(
		{
			"jsconfig.json": "{}",
			"src/app.js": "const x = 1;",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const root = server.findRoot(join(dir, "src/app.js"), dir, {});
			assertEquals(root, dir, "Should find root at jsconfig.json location");
		},
	);
});

test("typescript: returns undefined for deno projects", async () => {
	await withTempDir(
		{
			"deno.json": "{}",
			"main.ts": "console.log('deno');",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const root = server.findRoot(join(dir, "main.ts"), dir, {});
			assertEquals(
				root,
				undefined,
				"Should return undefined for deno projects",
			);
		},
	);
});

test("typescript: nested package finds nearest root", async () => {
	await withTempDir(
		{
			"package.json": "{}",
			"packages/web/package.json": "{}",
			"packages/web/src/index.ts": "export const x = 1;",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const root = server.findRoot(
				join(dir, "packages/web/src/index.ts"),
				dir,
				{},
			);
			assertEquals(
				root,
				join(dir, "packages/web"),
				"Should find nearest package.json",
			);
		},
	);
});

// ============================================================================
// Dart root detection tests
// ============================================================================

test("dart: finds root with pubspec.yaml", async () => {
	await withTempDir(
		{
			"pubspec.yaml": "name: my_app",
			"lib/main.dart": "void main() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "dart")!;
			const root = server.findRoot(join(dir, "lib/main.dart"), dir, {});
			assertEquals(root, dir, "Should find root at pubspec.yaml location");
		},
	);
});

test("dart: finds root with analysis_options.yaml", async () => {
	await withTempDir(
		{
			"analysis_options.yaml": "linter: rules:",
			"lib/main.dart": "void main() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "dart")!;
			const root = server.findRoot(join(dir, "lib/main.dart"), dir, {});
			assertEquals(
				root,
				dir,
				"Should find root at analysis_options.yaml location",
			);
		},
	);
});

test("dart: nested package finds nearest root", async () => {
	await withTempDir(
		{
			"pubspec.yaml": "name: monorepo",
			"packages/core/pubspec.yaml": "name: core",
			"packages/core/lib/core.dart": "void init() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "dart")!;
			const root = server.findRoot(
				join(dir, "packages/core/lib/core.dart"),
				dir,
				{},
			);
			assertEquals(
				root,
				join(dir, "packages/core"),
				"Should find nearest pubspec.yaml",
			);
		},
	);
});

// ============================================================================
// Rust root detection tests
// ============================================================================

test("rust: finds root with Cargo.toml", async () => {
	await withTempDir(
		{
			"Cargo.toml": '[package]\nname = "my_crate"',
			"src/lib.rs": "pub fn hello() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "rust-analyzer")!;
			const root = server.findRoot(join(dir, "src/lib.rs"), dir, {});
			assertEquals(root, dir, "Should find root at Cargo.toml location");
		},
	);
});

test("rust: nested workspace member finds nearest Cargo.toml", async () => {
	await withTempDir(
		{
			"Cargo.toml": '[workspace]\nmembers = ["crates/*"]',
			"crates/core/Cargo.toml": '[package]\nname = "core"',
			"crates/core/src/lib.rs": "pub fn init() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "rust-analyzer")!;
			const root = server.findRoot(
				join(dir, "crates/core/src/lib.rs"),
				dir,
				{},
			);
			assertEquals(
				root,
				join(dir, "crates/core"),
				"Should find nearest Cargo.toml",
			);
		},
	);
});

// ============================================================================
// Go root detection tests (including gopls bug fix verification)
// ============================================================================

test("gopls: finds root with go.mod", async () => {
	await withTempDir(
		{
			"go.mod": "module example.com/myapp",
			"main.go": "package main",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "gopls")!;
			const root = server.findRoot(join(dir, "main.go"), dir, {});
			assertEquals(root, dir, "Should find root at go.mod location");
		},
	);
});

test("gopls: finds root with go.work (workspace)", async () => {
	await withTempDir(
		{
			"go.work": "go 1.21\nuse ./app",
			"app/go.mod": "module example.com/app",
			"app/main.go": "package main",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "gopls")!;
			const root = server.findRoot(join(dir, "app/main.go"), dir, {});
			assertEquals(
				root,
				dir,
				"Should find root at go.work location (workspace root)",
			);
		},
	);
});

test("gopls: prefers go.work over go.mod", async () => {
	await withTempDir(
		{
			"go.work": "go 1.21\nuse ./app",
			"go.mod": "module example.com/root",
			"app/go.mod": "module example.com/app",
			"app/main.go": "package main",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "gopls")!;
			const root = server.findRoot(join(dir, "app/main.go"), dir, {});
			// go.work is found first, so it should return the go.work location
			assertEquals(root, dir, "Should prefer go.work over go.mod");
		},
	);
});

test("gopls: returns undefined when no go.mod or go.work (bug fix verification)", async () => {
	await withTempDir(
		{
			"main.go": "package main",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "gopls")!;
			const root = server.findRoot(join(dir, "main.go"), dir, {});
			// This test verifies the bug fix: previously this would return undefined
			// because `undefined !== cwd` was true, skipping the go.mod check
			assertEquals(
				root,
				undefined,
				"Should return undefined when no go.mod or go.work",
			);
		},
	);
});

test("gopls: finds go.mod when go.work not present (bug fix verification)", async () => {
	await withTempDir(
		{
			"go.mod": "module example.com/myapp",
			"cmd/server/main.go": "package main",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "gopls")!;
			const root = server.findRoot(join(dir, "cmd/server/main.go"), dir, {});
			// This is the key test for the bug fix
			// Previously: findRoot(go.work) returns undefined, then `undefined !== cwd` is true,
			// so it would return undefined without checking go.mod
			// After fix: if go.work not found, falls through to check go.mod
			assertEquals(root, dir, "Should find go.mod when go.work is not present");
		},
	);
});

// ============================================================================
// Kotlin root detection tests
// ============================================================================

test("kotlin: finds root with settings.gradle.kts", async () => {
	await withTempDir(
		{
			"settings.gradle.kts": 'rootProject.name = "myapp"',
			"app/src/main/kotlin/Main.kt": "fun main() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "kotlin")!;
			const root = server.findRoot(
				join(dir, "app/src/main/kotlin/Main.kt"),
				dir,
				{},
			);
			assertEquals(
				root,
				dir,
				"Should find root at settings.gradle.kts location",
			);
		},
	);
});

test("kotlin: prefers settings.gradle(.kts) over nested build.gradle", async () => {
	await withTempDir(
		{
			"settings.gradle": "rootProject.name = 'root'",
			"app/build.gradle": "plugins {}",
			"app/src/main/kotlin/Main.kt": "fun main() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "kotlin")!;
			const root = server.findRoot(
				join(dir, "app/src/main/kotlin/Main.kt"),
				dir,
				{},
			);
			assertEquals(
				root,
				dir,
				"Should prefer settings.gradle at workspace root",
			);
		},
	);
});

test("kotlin: finds root with pom.xml", async () => {
	await withTempDir(
		{
			"pom.xml": "<project></project>",
			"src/main/kotlin/Main.kt": "fun main() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "kotlin")!;
			const root = server.findRoot(
				join(dir, "src/main/kotlin/Main.kt"),
				dir,
				{},
			);
			assertEquals(root, dir, "Should find root at pom.xml location");
		},
	);
});

// ============================================================================
// Swift root detection tests
// ============================================================================

test("swift: finds root with Package.swift", async () => {
	await withTempDir(
		{
			"Package.swift": "// swift-tools-version: 5.9",
			"Sources/App/main.swift": 'print("hi")',
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "swift")!;
			const root = server.findRoot(
				join(dir, "Sources/App/main.swift"),
				dir,
				{},
			);
			assertEquals(root, dir, "Should find root at Package.swift location");
		},
	);
});

test("swift: finds root with Xcode project", async () => {
	await withTempDir(
		{
			"MyApp.xcodeproj/project.pbxproj": "// pbxproj",
			"MyApp/main.swift": 'print("hi")',
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "swift")!;
			const root = server.findRoot(join(dir, "MyApp/main.swift"), dir, {});
			assertEquals(root, dir, "Should find root at Xcode project location");
		},
	);
});

test("swift: finds root with Xcode workspace", async () => {
	await withTempDir(
		{
			"MyApp.xcworkspace/contents.xcworkspacedata": "<Workspace/>",
			"MyApp/main.swift": 'print("hi")',
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "swift")!;
			const root = server.findRoot(join(dir, "MyApp/main.swift"), dir, {});
			assertEquals(root, dir, "Should find root at Xcode workspace location");
		},
	);
});

// ============================================================================
// Python root detection tests
// ============================================================================

test("pyright: finds root with pyproject.toml", async () => {
	await withTempDir(
		{
			"pyproject.toml": '[project]\nname = "myapp"',
			"src/main.py": "print('hello')",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "pyright")!;
			const root = server.findRoot(join(dir, "src/main.py"), dir, {});
			assertEquals(root, dir, "Should find root at pyproject.toml location");
		},
	);
});

test("pyright: finds root with setup.py", async () => {
	await withTempDir(
		{
			"setup.py": "from setuptools import setup",
			"myapp/main.py": "print('hello')",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "pyright")!;
			const root = server.findRoot(join(dir, "myapp/main.py"), dir, {});
			assertEquals(root, dir, "Should find root at setup.py location");
		},
	);
});

test("pyright: finds root with requirements.txt", async () => {
	await withTempDir(
		{
			"requirements.txt": "flask>=2.0",
			"app.py": "from flask import Flask",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "pyright")!;
			const root = server.findRoot(join(dir, "app.py"), dir, {});
			assertEquals(root, dir, "Should find root at requirements.txt location");
		},
	);
});

// ============================================================================
// URI construction tests (pathToFileURL)
// ============================================================================

test("pathToFileURL: handles simple paths", async () => {
	const uri = pathToFileURL("/home/user/project/file.ts").href;
	assertEquals(
		uri,
		"file:///home/user/project/file.ts",
		"Should create proper file URI",
	);
});

test("pathToFileURL: encodes special characters", async () => {
	const uri = pathToFileURL("/home/user/my project/file.ts").href;
	assert(uri.includes("my%20project"), "Should URL-encode spaces");
});

test("pathToFileURL: handles unicode", async () => {
	const uri = pathToFileURL("/home/user/项目/file.ts").href;
	// pathToFileURL properly encodes unicode
	assert(uri.startsWith("file:///"), "Should start with file:///");
	assert(uri.includes("file.ts"), "Should contain filename");
});

// ============================================================================
// Vue/Svelte root detection tests
// ============================================================================

test("vue: finds root with package.json", async () => {
	await withTempDir(
		{
			"package.json": "{}",
			"src/App.vue": "<template></template>",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "vue")!;
			const root = server.findRoot(join(dir, "src/App.vue"), dir, {});
			assertEquals(root, dir, "Should find root at package.json location");
		},
	);
});

test("vue: finds root with vite.config.ts", async () => {
	await withTempDir(
		{
			"vite.config.ts": "export default {}",
			"src/App.vue": "<template></template>",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "vue")!;
			const root = server.findRoot(join(dir, "src/App.vue"), dir, {});
			assertEquals(root, dir, "Should find root at vite.config.ts location");
		},
	);
});

test("svelte: finds root with svelte.config.js", async () => {
	await withTempDir(
		{
			"svelte.config.js": "export default {}",
			"src/App.svelte": "<script></script>",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "svelte")!;
			const root = server.findRoot(join(dir, "src/App.svelte"), dir, {});
			assertEquals(root, dir, "Should find root at svelte.config.js location");
		},
	);
});

// ============================================================================
// Additional Rust tests (parity with TypeScript)
// ============================================================================

test("rust: finds root in src subdirectory", async () => {
	await withTempDir(
		{
			"Cargo.toml": '[package]\nname = "myapp"',
			"src/main.rs": "fn main() {}",
			"src/lib.rs": "pub mod utils;",
			"src/utils/mod.rs": "pub fn helper() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "rust-analyzer")!;
			const root = server.findRoot(join(dir, "src/utils/mod.rs"), dir, {});
			assertEquals(root, dir, "Should find root from deeply nested src file");
		},
	);
});

test("rust: workspace with multiple crates", async () => {
	await withTempDir(
		{
			"Cargo.toml": '[workspace]\nmembers = ["crates/*"]',
			"crates/api/Cargo.toml": '[package]\nname = "api"',
			"crates/api/src/lib.rs": "pub fn serve() {}",
			"crates/core/Cargo.toml": '[package]\nname = "core"',
			"crates/core/src/lib.rs": "pub fn init() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "rust-analyzer")!;
			// Each crate should find its own Cargo.toml
			const apiRoot = server.findRoot(
				join(dir, "crates/api/src/lib.rs"),
				dir,
				{},
			);
			const coreRoot = server.findRoot(
				join(dir, "crates/core/src/lib.rs"),
				dir,
				{},
			);
			assertEquals(
				apiRoot,
				join(dir, "crates/api"),
				"API crate should find its Cargo.toml",
			);
			assertEquals(
				coreRoot,
				join(dir, "crates/core"),
				"Core crate should find its Cargo.toml",
			);
		},
	);
});

test("rust: returns undefined when no Cargo.toml", async () => {
	await withTempDir(
		{
			"main.rs": "fn main() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "rust-analyzer")!;
			const root = server.findRoot(join(dir, "main.rs"), dir, {});
			assertEquals(
				root,
				undefined,
				"Should return undefined when no Cargo.toml",
			);
		},
	);
});

// ============================================================================
// Additional Dart tests (parity with TypeScript)
// ============================================================================

test("dart: Flutter project with pubspec.yaml", async () => {
	await withTempDir(
		{
			"pubspec.yaml":
				"name: my_flutter_app\ndependencies:\n  flutter:\n    sdk: flutter",
			"lib/main.dart": "import 'package:flutter/material.dart';",
			"lib/screens/home.dart": "class HomeScreen {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "dart")!;
			const root = server.findRoot(join(dir, "lib/screens/home.dart"), dir, {});
			assertEquals(root, dir, "Should find root for Flutter project");
		},
	);
});

test("dart: returns undefined when no marker files", async () => {
	await withTempDir(
		{
			"main.dart": "void main() {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "dart")!;
			const root = server.findRoot(join(dir, "main.dart"), dir, {});
			assertEquals(
				root,
				undefined,
				"Should return undefined when no pubspec.yaml or analysis_options.yaml",
			);
		},
	);
});

test("dart: monorepo with multiple packages", async () => {
	await withTempDir(
		{
			"pubspec.yaml": "name: monorepo",
			"packages/auth/pubspec.yaml": "name: auth",
			"packages/auth/lib/auth.dart": "class Auth {}",
			"packages/ui/pubspec.yaml": "name: ui",
			"packages/ui/lib/widgets.dart": "class Button {}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "dart")!;
			const authRoot = server.findRoot(
				join(dir, "packages/auth/lib/auth.dart"),
				dir,
				{},
			);
			const uiRoot = server.findRoot(
				join(dir, "packages/ui/lib/widgets.dart"),
				dir,
				{},
			);
			assertEquals(
				authRoot,
				join(dir, "packages/auth"),
				"Auth package should find its pubspec",
			);
			assertEquals(
				uiRoot,
				join(dir, "packages/ui"),
				"UI package should find its pubspec",
			);
		},
	);
});

// ============================================================================
// Additional Python tests (parity with TypeScript)
// ============================================================================

test("pyright: finds root with pyrightconfig.json", async () => {
	await withTempDir(
		{
			"pyrightconfig.json": "{}",
			"src/app.py": "print('hello')",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "pyright")!;
			const root = server.findRoot(join(dir, "src/app.py"), dir, {});
			assertEquals(
				root,
				dir,
				"Should find root at pyrightconfig.json location",
			);
		},
	);
});

test("pyright: returns undefined when no marker files", async () => {
	await withTempDir(
		{
			"script.py": "print('hello')",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "pyright")!;
			const root = server.findRoot(join(dir, "script.py"), dir, {});
			assertEquals(
				root,
				undefined,
				"Should return undefined when no Python project markers",
			);
		},
	);
});

test("pyright: monorepo with multiple packages", async () => {
	await withTempDir(
		{
			"pyproject.toml": '[project]\nname = "monorepo"',
			"packages/api/pyproject.toml": '[project]\nname = "api"',
			"packages/api/src/main.py": "from flask import Flask",
			"packages/worker/pyproject.toml": '[project]\nname = "worker"',
			"packages/worker/src/tasks.py": "def process(): pass",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "pyright")!;
			const apiRoot = server.findRoot(
				join(dir, "packages/api/src/main.py"),
				dir,
				{},
			);
			const workerRoot = server.findRoot(
				join(dir, "packages/worker/src/tasks.py"),
				dir,
				{},
			);
			assertEquals(
				apiRoot,
				join(dir, "packages/api"),
				"API package should find its pyproject.toml",
			);
			assertEquals(
				workerRoot,
				join(dir, "packages/worker"),
				"Worker package should find its pyproject.toml",
			);
		},
	);
});

test("basedpyright: finds root with basedpyrightconfig.json", async () => {
	await withTempDir(
		{
			"basedpyrightconfig.json": "{}",
			"src/app.py": "print('hello')",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "basedpyright")!;
			const root = server.findRoot(join(dir, "src/app.py"), dir, {});
			assertEquals(
				root,
				dir,
				"Should find root at basedpyrightconfig.json location",
			);
		},
	);
});

test("ty: finds root with ty.toml", async () => {
	await withTempDir(
		{
			"ty.toml": "[tool.ty]",
			"src/app.py": "print('hello')",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "ty")!;
			const root = server.findRoot(join(dir, "src/app.py"), dir, {});
			assertEquals(root, dir, "Should find root at ty.toml location");
		},
	);
});

test("ty: falls back to pyproject.toml", async () => {
	await withTempDir(
		{
			"pyproject.toml": '[project]\nname = "app"',
			"src/app.py": "print('hello')",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "ty")!;
			const root = server.findRoot(join(dir, "src/app.py"), dir, {});
			assertEquals(
				root,
				dir,
				"Should still find root at pyproject.toml location",
			);
		},
	);
});

// ============================================================================
// Additional Go tests
// ============================================================================

test("gopls: monorepo with multiple modules", async () => {
	await withTempDir(
		{
			"go.work": "go 1.21\nuse (\n  ./api\n  ./worker\n)",
			"api/go.mod": "module example.com/api",
			"api/main.go": "package main",
			"worker/go.mod": "module example.com/worker",
			"worker/main.go": "package main",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "gopls")!;
			// With go.work present, all files should use workspace root
			const apiRoot = server.findRoot(join(dir, "api/main.go"), dir, {});
			const workerRoot = server.findRoot(join(dir, "worker/main.go"), dir, {});
			assertEquals(apiRoot, dir, "API module should use go.work root");
			assertEquals(workerRoot, dir, "Worker module should use go.work root");
		},
	);
});

test("gopls: nested cmd directory", async () => {
	await withTempDir(
		{
			"go.mod": "module example.com/myapp",
			"cmd/server/main.go": "package main",
			"cmd/cli/main.go": "package main",
			"internal/db/db.go": "package db",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "gopls")!;
			const serverRoot = server.findRoot(
				join(dir, "cmd/server/main.go"),
				dir,
				{},
			);
			const cliRoot = server.findRoot(join(dir, "cmd/cli/main.go"), dir, {});
			const dbRoot = server.findRoot(join(dir, "internal/db/db.go"), dir, {});
			assertEquals(serverRoot, dir, "cmd/server should find go.mod at root");
			assertEquals(cliRoot, dir, "cmd/cli should find go.mod at root");
			assertEquals(dbRoot, dir, "internal/db should find go.mod at root");
		},
	);
});

// ============================================================================
// Additional TypeScript tests
// ============================================================================

test("typescript: pnpm workspace", async () => {
	await withTempDir(
		{
			"package.json": "{}",
			"pnpm-workspace.yaml": "packages:\n  - packages/*",
			"packages/web/package.json": "{}",
			"packages/web/src/App.tsx": "export const App = () => null;",
			"packages/api/package.json": "{}",
			"packages/api/src/index.ts": "export const handler = () => {};",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const webRoot = server.findRoot(
				join(dir, "packages/web/src/App.tsx"),
				dir,
				{},
			);
			const apiRoot = server.findRoot(
				join(dir, "packages/api/src/index.ts"),
				dir,
				{},
			);
			assertEquals(
				webRoot,
				join(dir, "packages/web"),
				"Web package should find its package.json",
			);
			assertEquals(
				apiRoot,
				join(dir, "packages/api"),
				"API package should find its package.json",
			);
		},
	);
});

test("typescript: returns undefined when no config files", async () => {
	await withTempDir(
		{
			"script.ts": "const x = 1;",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const root = server.findRoot(join(dir, "script.ts"), dir, {});
			assertEquals(
				root,
				undefined,
				"Should return undefined when no package.json or tsconfig.json",
			);
		},
	);
});

test("typescript: prefers nearest tsconfig over package.json", async () => {
	await withTempDir(
		{
			"package.json": "{}",
			"apps/web/tsconfig.json": "{}",
			"apps/web/src/index.ts": "export const x = 1;",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const root = server.findRoot(join(dir, "apps/web/src/index.ts"), dir, {});
			// Should find tsconfig.json first (it's nearer than root package.json)
			assertEquals(
				root,
				join(dir, "apps/web"),
				"Should find nearest config file",
			);
		},
	);
});

// ============================================================================
// Additional Vue/Svelte tests
// ============================================================================

test("vue: Nuxt project", async () => {
	await withTempDir(
		{
			"package.json": "{}",
			"nuxt.config.ts": "export default {}",
			"pages/index.vue": "<template></template>",
			"components/Button.vue": "<template></template>",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "vue")!;
			const pagesRoot = server.findRoot(join(dir, "pages/index.vue"), dir, {});
			const componentsRoot = server.findRoot(
				join(dir, "components/Button.vue"),
				dir,
				{},
			);
			assertEquals(pagesRoot, dir, "Pages should find root");
			assertEquals(componentsRoot, dir, "Components should find root");
		},
	);
});

test("vue: returns undefined when no config", async () => {
	await withTempDir(
		{
			"App.vue": "<template></template>",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "vue")!;
			const root = server.findRoot(join(dir, "App.vue"), dir, {});
			assertEquals(
				root,
				undefined,
				"Should return undefined when no package.json or vite.config",
			);
		},
	);
});

test("svelte: SvelteKit project", async () => {
	await withTempDir(
		{
			"package.json": "{}",
			"svelte.config.js": "export default {}",
			"src/routes/+page.svelte": "<script></script>",
			"src/lib/components/Button.svelte": "<script></script>",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "svelte")!;
			const routeRoot = server.findRoot(
				join(dir, "src/routes/+page.svelte"),
				dir,
				{},
			);
			const libRoot = server.findRoot(
				join(dir, "src/lib/components/Button.svelte"),
				dir,
				{},
			);
			assertEquals(routeRoot, dir, "Route should find root");
			assertEquals(libRoot, dir, "Lib component should find root");
		},
	);
});

test("svelte: returns undefined when no config", async () => {
	await withTempDir(
		{
			"App.svelte": "<script></script>",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "svelte")!;
			const root = server.findRoot(join(dir, "App.svelte"), dir, {});
			assertEquals(
				root,
				undefined,
				"Should return undefined when no package.json or svelte.config.js",
			);
		},
	);
});

// ============================================================================
// Stop boundary tests (findNearestFile respects cwd boundary)
// ============================================================================

test("stop boundary: does not search above cwd", async () => {
	await withTempDir(
		{
			"package.json": "{}", // This is at root
			"projects/myapp/src/index.ts": "export const x = 1;",
			// Note: no package.json in projects/myapp
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			// When cwd is set to projects/myapp, it should NOT find the root package.json
			const projectDir = join(dir, "projects/myapp");
			const root = server.findRoot(
				join(projectDir, "src/index.ts"),
				projectDir,
				{},
			);
			assertEquals(
				root,
				undefined,
				"Should not find package.json above cwd boundary",
			);
		},
	);
});

test("stop boundary: finds marker at cwd level", async () => {
	await withTempDir(
		{
			"projects/myapp/package.json": "{}",
			"projects/myapp/src/index.ts": "export const x = 1;",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const projectDir = join(dir, "projects/myapp");
			const root = server.findRoot(
				join(projectDir, "src/index.ts"),
				projectDir,
				{},
			);
			assertEquals(root, projectDir, "Should find package.json at cwd level");
		},
	);
});

// ============================================================================
// Edge cases
// ============================================================================

test("edge: deeply nested file finds correct root", async () => {
	await withTempDir(
		{
			"package.json": "{}",
			"src/components/ui/buttons/primary/Button.tsx":
				"export const Button = () => null;",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const root = server.findRoot(
				join(dir, "src/components/ui/buttons/primary/Button.tsx"),
				dir,
				{},
			);
			assertEquals(root, dir, "Should find root even for deeply nested files");
		},
	);
});

test("edge: file at root level finds root", async () => {
	await withTempDir(
		{
			"package.json": "{}",
			"index.ts": "console.log('root');",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const root = server.findRoot(join(dir, "index.ts"), dir, {});
			assertEquals(root, dir, "Should find root for file at root level");
		},
	);
});

test("edge: no marker files returns undefined", async () => {
	await withTempDir(
		{
			"random.ts": "const x = 1;",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const root = server.findRoot(join(dir, "random.ts"), dir, {});
			assertEquals(
				root,
				undefined,
				"Should return undefined when no marker files",
			);
		},
	);
});

// ============================================================================
// Settings tests
// ============================================================================

test("settings: project server config overrides global config", async () => {
	await withTempDir(
		{
			".pi": null,
			"global-settings.json": JSON.stringify({
				lsp: {
					servers: {
						typescript: {
							command: "global-tsls",
							args: ["--stdio"],
							env: { GLOBAL_FLAG: "1" },
							initializationOptions: { hostInfo: "global" },
						},
					},
				},
			}),
			".pi/settings.json": JSON.stringify({
				lsp: {
					servers: {
						typescript: {
							command: "project-tsls",
							env: { PROJECT_FLAG: "1" },
							workspaceConfiguration: {
								typescript: { format: { semicolons: "remove" } },
							},
						},
					},
				},
			}),
		},
		async (dir) => {
			const settings = loadResolvedLspSettings(dir, {
				globalSettingsPath: join(dir, "global-settings.json"),
				projectSettingsPath: join(dir, ".pi/settings.json"),
			});

			assertEquals(
				settings.servers.typescript?.command,
				"project-tsls",
				"Project command should override global command",
			);
			assertEquals(
				settings.servers.typescript?.args?.[0],
				"--stdio",
				"Global args should be preserved when project omits them",
			);
			assertEquals(
				settings.servers.typescript?.env?.GLOBAL_FLAG,
				"1",
				"Global env should be retained",
			);
			assertEquals(
				settings.servers.typescript?.env?.PROJECT_FLAG,
				"1",
				"Project env should merge in",
			);
			assertEquals(
				(settings.servers.typescript?.initializationOptions as any)?.hostInfo,
				"global",
				"Global initialization options should remain",
			);
			assertEquals(
				(settings.servers.typescript?.workspaceConfiguration as any)?.typescript
					?.format?.semicolons,
				"remove",
				"Project workspace configuration should be applied",
			);
		},
	);
});

test("settings: custom root markers override defaults", async () => {
	await withTempDir(
		{
			".pi": null,
			".pi/settings.json": JSON.stringify({
				lsp: {
					servers: {
						typescript: {
							rootMarkers: ["custom.root"],
						},
					},
				},
			}),
			"custom.root": "",
			"src/index.ts": "export const x = 1;",
			"package.json": "{}",
		},
		async (dir) => {
			const server = LSP_SERVERS.find((s) => s.id === "typescript")!;
			const settings = loadResolvedLspSettings(dir, {
				projectSettingsPath: join(dir, ".pi/settings.json"),
				globalSettingsPath: join(dir, "missing-global.json"),
			});
			const root = server.findRoot(
				join(dir, "src/index.ts"),
				dir,
				settings.servers.typescript ?? {},
			);
			assertEquals(root, dir, "Custom root marker should be honored");
		},
	);
});

test("settings: python provider and hook mode merge project over global", async () => {
	await withTempDir(
		{
			".pi": null,
			"global-settings.json": JSON.stringify({
				lsp: {
					hookMode: "disabled",
					python: {
						provider: "basedpyright",
					},
				},
			}),
			".pi/settings.json": JSON.stringify({
				lsp: {
					hookMode: "agent_end",
					python: {
						provider: "ty",
					},
				},
			}),
		},
		async (dir) => {
			const settings = loadResolvedLspSettings(dir, {
				globalSettingsPath: join(dir, "global-settings.json"),
				projectSettingsPath: join(dir, ".pi/settings.json"),
			});

			assertEquals(
				settings.hookMode,
				"agent_end",
				"Project hook mode should override global hook mode",
			);
			assertEquals(
				settings.pythonProvider,
				"ty",
				"Project provider should override global provider",
			);
		},
	);
});

test("settings: formatter config merges project over global", async () => {
	await withTempDir(
		{
			".pi": null,
			"global-settings.json": JSON.stringify({
				formatter: {
					enabled: true,
					hookMode: "write",
					formatters: {
						prettier: {
							env: { PRETTIERD_DEFAULT_CONFIG: "/tmp/prettier.json" },
						},
					},
				},
			}),
			".pi/settings.json": JSON.stringify({
				formatter: {
					hookMode: "edit_write",
					formatters: {
						prettier: {
							disabled: true,
						},
						ruff: {
							command: "ruff",
						},
					},
				},
			}),
		},
		async (dir) => {
			const settings = loadResolvedLspSettings(dir, {
				globalSettingsPath: join(dir, "global-settings.json"),
				projectSettingsPath: join(dir, ".pi/settings.json"),
			});

			assertEquals(
				settings.formatterHookMode,
				"edit_write",
				"Project formatter hook mode should override global formatter hook mode",
			);
			assertEquals(
				settings.formatters.prettier?.disabled,
				true,
				"Project formatter overrides should be applied",
			);
			assertEquals(
				settings.formatters.prettier?.env?.PRETTIERD_DEFAULT_CONFIG,
				"/tmp/prettier.json",
				"Formatter env should merge from global settings",
			);
			assertEquals(
				settings.formatters.ruff?.command,
				"ruff",
				"Project-only formatter should be included",
			);
		},
	);
});

test("settings: analyzer config merges project over global", async () => {
	await withTempDir(
		{
			".pi": null,
			"global-settings.json": JSON.stringify({
				analyzer: {
					enabled: true,
					hookMode: "agent_end",
					tools: {
						semgrep: {
							env: { SEMGREP_APP_TOKEN: "global" },
						},
					},
				},
			}),
			".pi/settings.json": JSON.stringify({
				analyzer: {
					hookMode: "edit_write",
					analyzers: {
						semgrep: {
							disabled: true,
						},
					},
				},
			}),
		},
		async (dir) => {
			const settings = loadResolvedLspSettings(dir, {
				globalSettingsPath: join(dir, "global-settings.json"),
				projectSettingsPath: join(dir, ".pi/settings.json"),
			});

			assertEquals(
				settings.analyzerHookMode,
				"edit_write",
				"Project analyzer hook mode should override global analyzer hook mode",
			);
			assertEquals(
				settings.analyzers.semgrep?.disabled,
				true,
				"Project analyzer overrides should be applied",
			);
			assertEquals(
				settings.analyzers.semgrep?.env?.SEMGREP_APP_TOKEN,
				"global",
				"Analyzer env should merge from global settings",
			);
		},
	);
});

test("formatter matching: project settings can disable specific formatter", async () => {
	await withTempDir(
		{
			".pi": null,
			".pi/settings.json": JSON.stringify({
				formatter: {
					formatters: {
						biome: { disabled: true },
					},
				},
			}),
			"package.json": "{}",
			"src/index.ts": "export const x = 1;",
		},
		async (dir) => {
			const matches = getFormatterConfigsForFile(
				join(dir, "src/index.ts"),
				dir,
			);
			assert(
				matches.some((formatter) => formatter.id === "prettier"),
				"Prettier should still match",
			);
			assert(
				!matches.some((formatter) => formatter.id === "biome"),
				"Biome should be excluded when disabled in settings",
			);
		},
	);
});

test("formatter matching: rumdl matches markdown files", async () => {
	await withTempDir(
		{
			"docs/guide.md": "# Guide",
		},
		async (dir) => {
			const matches = getFormatterConfigsForFile(
				join(dir, "docs/guide.md"),
				dir,
			);
			assert(
				matches.some((formatter) => formatter.id === "rumdl"),
				"rumdl should match markdown files",
			);
		},
	);
});

test("formatter matching: markdown prefers rumdl and avoids biome", async () => {
	await withTempDir(
		{
			"docs/guide.md": "# Guide",
		},
		async (dir) => {
			const matches = getFormatterConfigsForFile(
				join(dir, "docs/guide.md"),
				dir,
			);
			assertEquals(
				matches[0]?.id,
				"rumdl",
				"Markdown should prefer rumdl first",
			);
			assert(
				matches.some((formatter) => formatter.id === "prettier"),
				"prettier should remain available as a fallback for markdown",
			);
			assert(
				!matches.some((formatter) => formatter.id === "biome"),
				"biome should not claim markdown files",
			);
		},
	);
});

test("analyzer matching: semgrep matches supported files", async () => {
	await withTempDir(
		{
			"src/index.ts": "export const x = 1;",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "src/index.ts"), dir);
			assert(
				matches.some((analyzer) => analyzer.id === "semgrep"),
				"semgrep should match ts files",
			);
		},
	);
});

test("analyzer matching: ruff-check matches python files", async () => {
	await withTempDir(
		{
			"src/app.py": "print('hello')",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "src/app.py"), dir);
			assert(
				matches.some((analyzer) => analyzer.id === "ruff-check"),
				"ruff-check should match python files",
			);
		},
	);
});

test("analyzer matching: golangci-lint matches go files", async () => {
	await withTempDir(
		{
			"main.go": "package main",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "main.go"), dir);
			assert(
				matches.some((analyzer) => analyzer.id === "golangci-lint"),
				"golangci-lint should match go files",
			);
		},
	);
});

test("analyzer matching: markdownlint matches markdown files", async () => {
	await withTempDir(
		{
			"README.md": "# hello",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "README.md"), dir);
			assert(
				matches.some((analyzer) => analyzer.id === "markdownlint"),
				"markdownlint should match markdown files",
			);
		},
	);
});

test("analyzer matching: lychee matches markdown files", async () => {
	await withTempDir(
		{
			"README.md": "# hello",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "README.md"), dir);
			assert(
				matches.some((analyzer) => analyzer.id === "lychee"),
				"lychee should match markdown files",
			);
		},
	);
});

test("analyzer matching: lychee matches html files", async () => {
	await withTempDir(
		{
			"site/index.html": '<a href="https://example.invalid/docs">broken</a>',
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(
				join(dir, "site/index.html"),
				dir,
			);
			assert(
				matches.some((analyzer) => analyzer.id === "lychee"),
				"lychee should match html files",
			);
		},
	);
});

test("analyzer matching: slopgrep matches prose files", async () => {
	await withTempDir(
		{
			"docs/notes.md": "Here is a note.",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(
				join(dir, "docs/notes.md"),
				dir,
			);
			assert(
				matches.some((analyzer) => analyzer.id === "slopgrep"),
				"slopgrep should match markdown files",
			);
		},
	);
});

test("analyzer matching: slopgrep matches tex files", async () => {
	await withTempDir(
		{
			"paper/main.tex": "\\section{Intro}",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(
				join(dir, "paper/main.tex"),
				dir,
			);
			assert(
				matches.some((analyzer) => analyzer.id === "slopgrep"),
				"slopgrep should match tex files",
			);
		},
	);
});

test("analyzer matching: zippy matches text files", async () => {
	await withTempDir(
		{
			"docs/sample.txt": "This is plain prose.",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(
				join(dir, "docs/sample.txt"),
				dir,
			);
			assert(
				matches.some((analyzer) => analyzer.id === "zippy"),
				"zippy should match text files",
			);
		},
	);
});

test("analyzer matching: shellcheck matches shell files", async () => {
	await withTempDir(
		{
			"script.sh": "echo hi",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "script.sh"), dir);
			assert(
				matches.some((analyzer) => analyzer.id === "shellcheck"),
				"shellcheck should match shell files",
			);
		},
	);
});

test("analyzer matching: sloppylint matches python files", async () => {
	await withTempDir(
		{
			"src/app.py": "print('hello')",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "src/app.py"), dir);
			assert(
				matches.some((analyzer) => analyzer.id === "sloppylint"),
				"sloppylint should match python files",
			);
		},
	);
});

test("analyzer matching: karpeslop matches ts files", async () => {
	await withTempDir(
		{
			"src/app.ts": "export const x = 1;",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "src/app.ts"), dir);
			assert(
				matches.some((analyzer) => analyzer.id === "karpeslop"),
				"karpeslop should match ts files",
			);
		},
	);
});

test("analyzer matching: hadolint matches Dockerfile", async () => {
	await withTempDir(
		{
			Dockerfile: "FROM alpine:latest",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "Dockerfile"), dir);
			assert(
				matches.some((analyzer) => analyzer.id === "hadolint"),
				"hadolint should match Dockerfile",
			);
		},
	);
});

test("analyzer matching: project settings can disable semgrep", async () => {
	await withTempDir(
		{
			".pi": null,
			".pi/settings.json": JSON.stringify({
				analyzer: {
					analyzers: {
						semgrep: { disabled: true },
					},
				},
			}),
			"src/index.ts": "export const x = 1;",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "src/index.ts"), dir);
			assert(
				!matches.some((analyzer) => analyzer.id === "semgrep"),
				"semgrep should be excluded when disabled in settings",
			);
		},
	);
});

test("analyzer matching: multiple analyzers can match one python file", async () => {
	await withTempDir(
		{
			"src/app.py": "print('hello')",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "src/app.py"), dir);
			assert(
				matches.some((analyzer) => analyzer.id === "ruff-check"),
				"ruff-check should match python files",
			);
			assert(
				matches.some((analyzer) => analyzer.id === "sloppylint"),
				"sloppylint should also match python files",
			);
		},
	);
});

test("analyzer matching: multiple analyzers can match one ts file", async () => {
	await withTempDir(
		{
			"src/app.ts": "export const x = 1;",
		},
		async (dir) => {
			const matches = getAnalyzerConfigsForFile(join(dir, "src/app.ts"), dir);
			assert(
				matches.some((analyzer) => analyzer.id === "semgrep"),
				"semgrep should match ts files",
			);
			assert(
				matches.some((analyzer) => analyzer.id === "karpeslop"),
				"karpeslop should also match ts files",
			);
		},
	);
});

test("runAnalyzersForFile: lychee maps broken links back to source lines", async () => {
	await withTempDir(
		{
			".pi": null,
			"docs/README.md":
				"[good](https://example.com)\n[broken](https://example.invalid/docs)\n",
		},
		async (dir) => {
			const fakeLychee = join(dir, "fake-lychee.sh");
			await writeFile(
				fakeLychee,
				`#!/bin/sh
file=""
for arg in "$@"; do
  file="$arg"
done
cat <<EOF
{
  "error_map": {
    "$file": [
      {
        "url": "https://example.invalid/docs",
        "status": {
          "text": "HTTP status client error (404 Not Found)",
          "details": "404 Not Found"
        }
      }
    ]
  }
}
EOF
exit 2
`,
			);
			await chmod(fakeLychee, 0o755);
			await writeFile(
				join(dir, ".pi/settings.json"),
				JSON.stringify({
					analyzer: {
						analyzers: {
							semgrep: { disabled: true },
							lychee: { command: fakeLychee },
							markdownlint: { disabled: true },
							slopgrep: { disabled: true },
							zippy: { disabled: true },
						},
					},
				}),
			);

			const result = await runAnalyzersForFile(
				join(dir, "docs/README.md"),
				dir,
			);
			assertIncludes(
				result.analyzerIds ?? [],
				"lychee",
				"lychee should be reported as the analyzer that ran",
			);
			assertEquals(result.findings.length, 1, "Expected one lychee finding");
			assertEquals(
				result.findings[0]?.line,
				2,
				"Broken link should map to the second line",
			);
			assertEquals(
				result.findings[0]?.column,
				10,
				"Broken link should map to the URL column",
			);
			assert(
				result.findings[0]?.message.includes("404 Not Found"),
				`Expected lychee message to include HTTP details, got ${result.findings[0]?.message}`,
			);
		},
	);
});

test("runAnalyzersForFile: markdownlint parses JSON findings from stderr", async () => {
	await withTempDir(
		{
			".pi": null,
			"docs/README.md": "# Title\n## Section\n",
		},
		async (dir) => {
			const fakeMarkdownlint = join(dir, "fake-markdownlint.sh");
			await writeFile(
				fakeMarkdownlint,
				`#!/bin/sh
file=""
for arg in "$@"; do
  file="$arg"
done
cat >&2 <<EOF
[
  {
    "fileName": "$file",
    "lineNumber": 2,
    "ruleNames": ["MD022"],
    "ruleDescription": "Headings should be surrounded by blank lines",
    "errorDetail": "Expected: 1; Actual: 0; Above",
    "errorContext": "## Section"
  }
]
EOF
exit 1
`,
			);
			await chmod(fakeMarkdownlint, 0o755);
			await writeFile(
				join(dir, ".pi/settings.json"),
				JSON.stringify({
					analyzer: {
						analyzers: {
							semgrep: { disabled: true },
							lychee: { disabled: true },
							slopgrep: { disabled: true },
							zippy: { disabled: true },
							markdownlint: { command: fakeMarkdownlint },
						},
					},
				}),
			);

			const result = await runAnalyzersForFile(
				join(dir, "docs/README.md"),
				dir,
			);
			assertIncludes(
				result.analyzerIds ?? [],
				"markdownlint",
				"markdownlint should be reported as the analyzer that ran",
			);
			assertEquals(
				result.findings.length,
				1,
				"Expected one markdownlint finding",
			);
			assertEquals(
				result.findings[0]?.source,
				"markdownlint",
				"Expected markdownlint finding source",
			);
			assertEquals(
				result.findings[0]?.line,
				2,
				"Expected markdownlint line number from stderr JSON",
			);
			assert(
				!result.error,
				`Did not expect stderr JSON to be treated as an analyzer error: ${result.error ?? ""}`,
			);
		},
	);
});

test("runAnalyzersForFile: zippy parses classification notes", async () => {
	await withTempDir(
		{
			".pi": null,
			"docs/sample.txt": "This is a prose sample.",
		},
		async (dir) => {
			const fakeZippy = join(dir, "fake-zippy.sh");
			await writeFile(
				fakeZippy,
				`#!/bin/sh
file=""
for arg in "$@"; do
  file="$arg"
done
printf '%s\n' "$file"
printf "('AI', 0.4205)\n"
`,
			);
			await chmod(fakeZippy, 0o755);
			await writeFile(
				join(dir, ".pi/settings.json"),
				JSON.stringify({
					analyzer: {
						analyzers: {
							lychee: { disabled: true },
							slopgrep: { disabled: true },
							zippy: { command: fakeZippy },
						},
					},
				}),
			);

			const result = await runAnalyzersForFile(
				join(dir, "docs/sample.txt"),
				dir,
			);
			assertIncludes(
				result.analyzerIds ?? [],
				"zippy",
				"zippy should be reported as the analyzer that ran",
			);
			assertEquals(result.findings.length, 0, "Expected no zippy findings");
			assertEquals(
				result.notes?.length ?? 0,
				1,
				"Expected one zippy classification note",
			);
			assertEquals(
				result.notes?.[0]?.source,
				"zippy",
				"Expected zippy note source",
			);
			assert(
				result.notes?.[0]?.message.includes("AI-generated (zippy score") ?? false,
				`Expected zippy note to include classification, got ${result.notes?.[0]?.message ?? "<missing>"}`,
			);
			assert(
				result.notes?.[0]?.message.includes("zippy score 0.4205") ?? false,
				`Expected zippy note to include raw score, got ${result.notes?.[0]?.message ?? "<missing>"}`,
			);
			assert(
				result.notes?.[0]?.message.includes("raw 0.4205") ?? false,
				`Expected zippy note to retain the raw score, got ${result.notes?.[0]?.message ?? "<missing>"}`,
			);
			assert(
				result.notes?.[0]?.message.includes("not a probability") ?? false,
				`Expected zippy note to clarify score semantics, got ${result.notes?.[0]?.message ?? "<missing>"}`,
			);
			assert(
				!result.error,
				`Did not expect parsed zippy output to be treated as an analyzer error: ${result.error ?? ""}`,
			);
		},
	);
});

test("runAnalyzersForFile: slopgrep ignores empty nested results", async () => {
	await withTempDir(
		{
			".pi": null,
			"docs/README.md": "# Notes\n\n- Keep this short.\n",
		},
		async (dir) => {
			const fakeSlopgrep = join(dir, "fake-slopgrep.sh");
			await writeFile(
				fakeSlopgrep,
				`#!/bin/sh
cat <<EOF
{
  "results": [
    {
      "path": "$1",
      "score": 0,
      "findings": []
    }
  ]
}
EOF
`,
			);
			await chmod(fakeSlopgrep, 0o755);
			await writeFile(
				join(dir, ".pi/settings.json"),
				JSON.stringify({
					analyzer: {
						analyzers: {
							semgrep: { disabled: true },
							markdownlint: { disabled: true },
							lychee: { disabled: true },
							slopgrep: { command: fakeSlopgrep },
							zippy: { disabled: true },
						},
					},
				}),
			);

			const result = await runAnalyzersForFile(
				join(dir, "docs/README.md"),
				dir,
			);
			assertIncludes(
				result.analyzerIds ?? [],
				"slopgrep",
				"slopgrep should be reported as the analyzer that ran",
			);
			assertEquals(
				result.findings.length,
				0,
				"Expected no slopgrep findings when nested findings are empty",
			);
			assert(
				!result.error,
				`Did not expect clean slopgrep output to be treated as an analyzer error: ${result.error ?? ""}`,
			);
		},
	);
});

test("runAnalyzersForFile: slopgrep parses nested findings", async () => {
	await withTempDir(
		{
			".pi": null,
			"docs/README.md": "# Strategic Overview\n\nPlaceholder\n",
		},
		async (dir) => {
			const fakeSlopgrep = join(dir, "fake-slopgrep.sh");
			await writeFile(
				fakeSlopgrep,
				`#!/bin/sh
target=""
for arg in "$@"; do
  case "$arg" in
    --*) ;;
    scan) ;;
    *) target="$arg" ;;
  esac
done
cat <<EOF
{
  "results": [
    {
      "path": "$target",
      "score": 4,
      "findings": [
        {
          "path": "$target",
          "line": 3,
          "column": 7,
          "severity": "info",
          "rule_id": "ai.semantic.abstract_hype_en",
          "message": "BM25 family match: abstraction-heavy prose (score=2.20)"
        }
      ]
    }
  ]
}
EOF
`,
			);
			await chmod(fakeSlopgrep, 0o755);
			await writeFile(
				join(dir, ".pi/settings.json"),
				JSON.stringify({
					analyzer: {
						analyzers: {
							semgrep: { disabled: true },
							markdownlint: { disabled: true },
							lychee: { disabled: true },
							slopgrep: { command: fakeSlopgrep },
							zippy: { disabled: true },
						},
					},
				}),
			);

			const result = await runAnalyzersForFile(
				join(dir, "docs/README.md"),
				dir,
			);
			assertEquals(result.findings.length, 1, "Expected one slopgrep finding");
			assertEquals(
				result.findings[0]?.source,
				"slopgrep",
				"Expected slopgrep finding source",
			);
			assertEquals(
				result.findings[0]?.ruleId,
				"ai.semantic.abstract_hype_en",
				"Expected nested slopgrep rule id",
			);
			assertEquals(
				result.findings[0]?.line,
				3,
				"Expected nested slopgrep line number",
			);
			assertEquals(
				result.findings[0]?.column,
				7,
				"Expected nested slopgrep column number",
			);
		},
	);
});

test("TreeSitterManager: extracts markdown symbols and folding ranges", async () => {
	await withTempDir(
		{
			"docs/guide.md":
				"# Title\n\nIntro\n\n## Details\n\n```ts\nconst x = 1;\n```\n",
		},
		async (dir) => {
			const file = join(dir, "docs/guide.md");
			const manager = new TreeSitterManager();

			assert(
				manager.supportsOperation(file, "documentSymbol"),
				"Expected markdown documentSymbol fallback support",
			);
			assert(
				manager.supportsOperation(file, "foldingRange"),
				"Expected markdown foldingRange fallback support",
			);

			const symbols = manager.getDocumentSymbols(file);
			assertEquals(
				symbols.length,
				1,
				`Expected one top-level markdown symbol, got ${symbols.length}`,
			);
			assertEquals(
				symbols[0]?.name,
				"Title",
				"Expected the top-level heading to become a symbol",
			);
			assertEquals(
				symbols[0]?.children?.[0]?.name,
				"Details",
				"Expected nested heading symbol for Details",
			);

			const ranges = manager.getFoldingRanges(file);
			assert(
				ranges.some((range) => range.startLine === 0 && range.endLine >= 7),
				`Expected heading folding range, got ${JSON.stringify(ranges)}`,
			);
			assert(
				ranges.some((range) => range.startLine === 6 && range.endLine === 8),
				`Expected fenced code block folding range, got ${JSON.stringify(ranges)}`,
			);
		},
	);
});

test("TreeSitterManager: keeps markdown navigation working with grammar-backed structure", async () => {
	const markdown = [
		"Title",
		"=====",
		"",
		"Intro paragraph with [details](#details) and [guide][guide-ref].",
		"",
		"## Details",
		"",
		"More text.",
		"",
		"[guide-ref]: https://example.com/docs",
		"",
	].join("\n");

	await withTempDir(
		{
			"docs/guide.md": markdown,
		},
		async (dir) => {
			const file = join(dir, "docs/guide.md");
			const manager = new TreeSitterManager();
			const linkLine = markdown.split("\n")[3]!;
			const headingLine = markdown.split("\n")[5]!;

			const symbols = manager.getDocumentSymbols(file);
			assertEquals(
				symbols.length,
				2,
				`Expected two top-level markdown sections, got ${JSON.stringify(symbols)}`,
			);
			assertEquals(
				symbols[0]?.name,
				"Title",
				"Expected setext heading to become the first top-level symbol",
			);
			assertEquals(
				symbols[1]?.name,
				"Details",
				"Expected ATX heading to become its own top-level section",
			);

			const headingReferences = manager.getReferences(
				file,
				6,
				headingLine.indexOf("Details") + 1,
			);
			assertEquals(
				headingReferences.length,
				2,
				`Expected heading references to include the heading and fragment link, got ${JSON.stringify(headingReferences)}`,
			);
			assert(
				headingReferences.some((location) => location.range.start.line === 5),
				`Expected heading reference on line 6, got ${JSON.stringify(headingReferences)}`,
			);
			assert(
				headingReferences.some((location) => location.range.start.line === 3),
				`Expected fragment link reference on line 4, got ${JSON.stringify(headingReferences)}`,
			);

			const headingDefinition = manager.getDefinition(
				file,
				4,
				linkLine.indexOf("#details") + 1,
			);
			assertEquals(
				headingDefinition.length,
				1,
				`Expected one heading definition target, got ${JSON.stringify(headingDefinition)}`,
			);
			assertEquals(
				headingDefinition[0]?.range.start.line,
				5,
				"Expected fragment link definition to land on the Details heading",
			);

			const referenceDefinition = manager.getDefinition(
				file,
				4,
				linkLine.indexOf("guide-ref") + 1,
			);
			assertEquals(
				referenceDefinition.length,
				1,
				`Expected one reference definition target, got ${JSON.stringify(referenceDefinition)}`,
			);
			assertEquals(
				referenceDefinition[0]?.range.start.line,
				9,
				"Expected reference definition to land on the link definition line",
			);

			const highlights = manager.getDocumentHighlights(
				file,
				4,
				linkLine.indexOf("guide-ref") + 1,
			);
			assertEquals(
				highlights.length,
				2,
				`Expected highlights for the usage and definition, got ${JSON.stringify(highlights)}`,
			);

			const hover = manager.getHover(
				file,
				4,
				linkLine.indexOf("guide-ref") + 1,
			);
			assert(
				hover !== null &&
					hover.contents !== undefined &&
					!Array.isArray(hover.contents) &&
					typeof hover.contents !== "string",
				"Expected markdown reference hover content",
			);
			if (
				hover === null ||
				Array.isArray(hover.contents) ||
				typeof hover.contents === "string"
			) {
				throw new Error(
					`Expected structured hover contents, got ${JSON.stringify(hover)}`,
				);
			}
			assert(
				hover.contents.value.includes("https://example.com/docs"),
				`Expected hover to include the resolved URL, got ${JSON.stringify(hover)}`,
			);
		},
	);
});

test("LSPManager: uses Markdown fallback for structural operations", async () => {
	await withTempDir(
		{
			".pi": null,
			".pi/settings.json": JSON.stringify({
				lsp: {
					servers: {
						markdown: { disabled: true },
					},
				},
			}),
			"README.md": "# Title\n\nIntro\n\n## Details\n\nMore text\n",
		},
		async (dir) => {
			const file = join(dir, "README.md");
			const manager = new LSPManager(dir);
			try {
				assert(
					await manager.supportsOperation(file, "documentSymbol"),
					"Expected markdown documentSymbol support via fallback",
				);
				assert(
					await manager.supportsOperation(file, "foldingRange"),
					"Expected markdown foldingRange support via fallback",
				);
				assertEquals(
					await manager.getOperationBackend(file, "documentSymbol"),
					"tree-sitter",
					"Expected markdown documentSymbol backend to use fallback",
				);

				const symbols = await manager.getDocumentSymbols(file);
				assert(
					symbols.some((symbol) => symbol.name === "Title"),
					`Expected markdown heading symbol, got ${symbols.map((symbol) => symbol.name).join(", ")}`,
				);

				const workspaceSymbols = await manager.getWorkspaceSymbols(
					file,
					"detail",
				);
				assertEquals(
					workspaceSymbols.length,
					1,
					`Expected one matching markdown workspace symbol, got ${workspaceSymbols.length}`,
				);
				assertEquals(
					workspaceSymbols[0]?.name,
					"Details",
					"Expected workspace symbol to come from markdown heading",
				);
			} finally {
				await manager.shutdown();
			}
		},
	);
});

test("resolveLspUiState: session override beats disk settings", async () => {
	await withTempDir(
		{
			".pi": null,
			"global-settings.json": JSON.stringify({
				lsp: {
					hookMode: "disabled",
					python: {
						provider: "basedpyright",
					},
				},
			}),
			".pi/settings.json": JSON.stringify({
				lsp: {
					hookMode: "agent_end",
					python: {
						provider: "ty",
					},
				},
			}),
		},
		async (dir) => {
			const resolved = resolveLspUiState(
				dir,
				{
					scope: "session",
					hookMode: "edit_write",
					pythonProvider: "basedpyright",
				},
				join(dir, "global-settings.json"),
			);

			assertEquals(
				resolved.hookMode,
				"edit_write",
				"Session hook mode should win",
			);
			assertEquals(
				resolved.hookScope,
				"session",
				"Hook scope should be session",
			);
			assertEquals(
				resolved.pythonProvider,
				"basedpyright",
				"Session provider should win",
			);
			assertEquals(
				resolved.pythonScope,
				"session",
				"Python scope should be session",
			);
		},
	);
});

test("resolveLspUiState: project scope is reported from disk settings", async () => {
	await withTempDir(
		{
			".pi": null,
			"global-settings.json": JSON.stringify({
				lsp: {
					hookMode: "disabled",
					python: {
						provider: "basedpyright",
					},
				},
			}),
			".pi/settings.json": JSON.stringify({
				lsp: {
					hookMode: "agent_end",
					python: {
						provider: "ty",
					},
				},
			}),
		},
		async (dir) => {
			const resolved = resolveLspUiState(
				dir,
				{
					scope: "project",
					hookMode: "agent_end",
					pythonProvider: "ty",
				},
				join(dir, "global-settings.json"),
			);

			assertEquals(
				resolved.hookMode,
				"agent_end",
				"Project hook mode should come from disk",
			);
			assertEquals(
				resolved.hookScope,
				"project",
				"Hook scope should be project",
			);
			assertEquals(
				resolved.pythonProvider,
				"ty",
				"Project provider should come from disk",
			);
			assertEquals(
				resolved.pythonScope,
				"project",
				"Python scope should be project",
			);
		},
	);
});

test("TreeSitterManager: reports syntax diagnostics without project config", async () => {
	await withTempDir(
		{
			"broken.ts": "const broken = ;\n",
		},
		async (dir) => {
			const manager = new TreeSitterManager();
			const diagnostics = manager.getDiagnostics(join(dir, "broken.ts"));

			assert(
				diagnostics.length > 0,
				"Expected Tree-sitter diagnostics for invalid TypeScript",
			);
			assert(
				diagnostics.some(
					(diagnostic) =>
						diagnostic.message.toLowerCase().includes("syntax") ||
						diagnostic.message.toLowerCase().includes("missing"),
				),
				`Expected syntax-oriented diagnostic message, got: ${diagnostics.map((diagnostic) => diagnostic.message).join(", ")}`,
			);
		},
	);
});

test("TreeSitterManager: supports bundled vscode tree-sitter wasm grammars", async () => {
	const manager = new TreeSitterManager();
	const fileNames = [
		"script.sh",
		"Program.cs",
		"main.cpp",
		"style.css",
		"main.go",
		"config.ini",
		"Main.java",
		"index.js",
		"index.php",
		"profile.ps1",
		"app.py",
		"pattern.regex",
		"app.rb",
		"main.rs",
		"component.tsx",
		"main.ts",
	];

	for (const fileName of fileNames) {
		assert(
			manager.supportsOperation(fileName, "diagnostics"),
			`Expected Tree-sitter diagnostics fallback support for ${fileName}`,
		);
	}
});

test("TreeSitterManager: extracts symbols from newly bundled grammars", async () => {
	await withTempDir(
		{
			"script.sh": "greet() { echo hi; }\n",
			"Program.cs": "class Greeter { string Greet(string name) { return name; } }\n",
			"main.go": "package main\nfunc greet(name string) string { return name }\n",
			"Main.java": "class Greeter { String greet(String name) { return name; } }\n",
			"index.php": "<?php function greet($name) { return $name; }\n",
			"app.rb": "class Greeter\n  def greet(name)\n    name\n  end\nend\n",
			"main.rs": "fn greet(name: &str) -> &str { name }\n",
		},
		async (dir) => {
			const manager = new TreeSitterManager();
			const expectations: Array<[string, string]> = [
				["script.sh", "greet"],
				["Program.cs", "Greeter"],
				["main.go", "greet"],
				["Main.java", "Greeter"],
				["index.php", "greet"],
				["app.rb", "Greeter"],
				["main.rs", "greet"],
			];

			for (const [fileName, expectedSymbol] of expectations) {
				const symbols = manager.getDocumentSymbols(join(dir, fileName));
				assert(
					symbols.some((symbol) => symbol.name === expectedSymbol),
					`Expected ${expectedSymbol} symbol in ${fileName}, got: ${symbols.map((symbol) => symbol.name).join(", ")}`,
				);
			}
		},
	);
});

test("TreeSitterManager: language-specific queries improve Go navigation", async () => {
	await withTempDir(
		{
			"main.go": `package main

const Answer = 42

type Person struct {
	Name string
}

func greet(name string) string {
	local := name
	return local
}

func main() {
	result := greet("a")
	_ = result
	_ = Answer
}
`,
		},
		async (dir) => {
			const file = join(dir, "main.go");
			const manager = new TreeSitterManager();
			const symbols = manager.getDocumentSymbols(file).map((symbol) => symbol.name);
			assert(
				symbols.includes("Answer") && symbols.includes("Person") && symbols.includes("greet"),
				`Expected Go symbols for const/type/function, got: ${symbols.join(", ")}`,
			);

			const functionDefinition = manager.getDefinition(file, 15, 13);
			assertEquals(
				functionDefinition[0]?.range.start.line,
				8,
				"Go call should resolve to the greet declaration",
			);

			const localDefinition = manager.getDefinition(file, 11, 10);
			assertEquals(
				localDefinition[0]?.range.start.line,
				9,
				"Go local identifier should resolve to the short variable declaration",
			);

			const functionReferences = manager.getReferences(file, 9, 6);
			assert(
				functionReferences.length >= 2,
				`Expected Go function references for declaration plus call, got ${functionReferences.length}`,
			);
		},
	);
});

test("TreeSitterManager: language-specific queries improve Rust navigation", async () => {
	await withTempDir(
		{
			"main.rs": `const ANSWER: i32 = 42;

struct Person {
	name: String,
}

fn greet(name: &str) -> &str {
	let local = name;
	local
}

fn main() {
	let result = greet("a");
	let _ = ANSWER;
}
`,
		},
		async (dir) => {
			const file = join(dir, "main.rs");
			const manager = new TreeSitterManager();
			const symbols = manager.getDocumentSymbols(file).map((symbol) => symbol.name);
			assert(
				symbols.includes("ANSWER") && symbols.includes("Person") && symbols.includes("greet"),
				`Expected Rust symbols for const/struct/function, got: ${symbols.join(", ")}`,
			);

			const functionDefinition = manager.getDefinition(file, 13, 15);
			assertEquals(
				functionDefinition[0]?.range.start.line,
				6,
				"Rust call should resolve to the greet declaration",
			);

			const localDefinition = manager.getDefinition(file, 9, 3);
			assertEquals(
				localDefinition[0]?.range.start.line,
				7,
				"Rust local identifier should resolve to the let declaration",
			);

			const constReferences = manager.getReferences(file, 1, 7);
			assert(
				constReferences.length >= 2,
				`Expected Rust const references for declaration plus usage, got ${constReferences.length}`,
			);
		},
	);
});

test("TreeSitterManager: language-specific queries improve Java navigation", async () => {
	await withTempDir(
		{
			"Main.java": `class Greeter {
	static final int ANSWER = 42;

	String greet(String name) {
		String local = name;
		return local;
	}

	void run() {
		String result = greet("a");
		int answer = ANSWER;
	}
}
`,
		},
		async (dir) => {
			const file = join(dir, "Main.java");
			const manager = new TreeSitterManager();
			const symbols = manager.getDocumentSymbols(file).map((symbol) => symbol.name);
			assert(
				symbols.includes("Greeter") && symbols.includes("ANSWER") && symbols.includes("greet"),
				`Expected Java symbols for class/field/method, got: ${symbols.join(", ")}`,
			);

			const methodDefinition = manager.getDefinition(file, 10, 19);
			assertEquals(
				methodDefinition[0]?.range.start.line,
				3,
				"Java method call should resolve to the greet declaration",
			);

			const localDefinition = manager.getDefinition(file, 6, 11);
			assertEquals(
				localDefinition[0]?.range.start.line,
				4,
				"Java local identifier should resolve to the local declaration",
			);

			const fieldReferences = manager.getReferences(file, 2, 19);
			assert(
				fieldReferences.length >= 2,
				`Expected Java field references for declaration plus usage, got ${fieldReferences.length}`,
			);
		},
	);
});

test("TreeSitterManager: language-specific queries improve Ruby navigation", async () => {
	await withTempDir(
		{
			"app.rb": `module Tools
	class Greeter
		ANSWER = 42

		def greet(name)
			local = name
			local
		end
	end
end

Greeter.new.greet("a")
`,
		},
		async (dir) => {
			const file = join(dir, "app.rb");
			const manager = new TreeSitterManager();
			const symbols = manager.getDocumentSymbols(file).map((symbol) => symbol.name);
			assert(
				symbols.includes("Tools") && symbols.includes("Greeter") && symbols.includes("ANSWER") && symbols.includes("greet"),
				`Expected Ruby symbols for module/class/constant/method, got: ${symbols.join(", ")}`,
			);

			const methodDefinition = manager.getDefinition(file, 12, 17);
			assertEquals(
				methodDefinition[0]?.range.start.line,
				4,
				"Ruby method call should resolve to the greet declaration",
			);

			const localDefinition = manager.getDefinition(file, 7, 5);
			assertEquals(
				localDefinition[0]?.range.start.line,
				5,
				"Ruby local identifier should resolve to the assignment",
			);

			const methodReferences = manager.getReferences(file, 5, 8);
			assert(
				methodReferences.length >= 2,
				`Expected Ruby method references for declaration plus call, got ${methodReferences.length}`,
			);
		},
	);
});

test("TreeSitterManager: language-specific queries improve PHP navigation", async () => {
	await withTempDir(
		{
			"index.php": `<?php
class Greeter {
	const ANSWER = 42;

	function greet($name) {
		$local = $name;
		return $local;
	}
}

function helper($value) {
	return $value;
}

helper("a");
`,
		},
		async (dir) => {
			const file = join(dir, "index.php");
			const manager = new TreeSitterManager();
			const symbols = manager.getDocumentSymbols(file).map((symbol) => symbol.name);
			assert(
				symbols.includes("Greeter") && symbols.includes("ANSWER") && symbols.includes("greet") && symbols.includes("helper"),
				`Expected PHP symbols for class/constant/functions, got: ${symbols.join(", ")}`,
			);

			const functionDefinition = manager.getDefinition(file, 15, 3);
			assertEquals(
				functionDefinition[0]?.range.start.line,
				10,
				"PHP function call should resolve to the helper declaration",
			);

			const localDefinition = manager.getDefinition(file, 7, 11);
			assertEquals(
				localDefinition[0]?.range.start.line,
				5,
				"PHP local variable should resolve to the assignment",
			);

			const functionReferences = manager.getReferences(file, 11, 10);
			assert(
				functionReferences.length >= 2,
				`Expected PHP helper references for declaration plus call, got ${functionReferences.length}`,
			);
		},
	);
});

test("TreeSitterManager: language-specific queries improve Bash navigation", async () => {
	await withTempDir(
		{
			"script.sh": `answer=42
greet() {
  echo hi
}
greet
`,
		},
		async (dir) => {
			const file = join(dir, "script.sh");
			const manager = new TreeSitterManager();
			const symbols = manager.getDocumentSymbols(file).map((symbol) => symbol.name);
			assert(
				symbols.includes("answer") && symbols.includes("greet"),
				`Expected Bash symbols for assignment and function, got: ${symbols.join(", ")}`,
			);

			const definition = manager.getDefinition(file, 5, 2);
			assertEquals(
				definition[0]?.range.start.line,
				1,
				"Bash command should resolve to the function declaration",
			);

			const references = manager.getReferences(file, 2, 2);
			assert(
				references.length >= 2,
				`Expected Bash references for declaration plus command call, got ${references.length}`,
			);
		},
	);
});

test("TreeSitterManager: language-specific queries improve C# navigation", async () => {
	await withTempDir(
		{
			"Program.cs": `class Greeter {
  const int Answer = 42;

  string Greet(string name) {
    var local = name;
    return local;
  }

  void Run() {
    var result = Greet("a");
  }
}
`,
		},
		async (dir) => {
			const file = join(dir, "Program.cs");
			const manager = new TreeSitterManager();
			const symbols = manager.getDocumentSymbols(file).map((symbol) => symbol.name);
			assert(
				symbols.includes("Greeter") && symbols.includes("Answer") && symbols.includes("Greet"),
				`Expected C# symbols for class/field/method, got: ${symbols.join(", ")}`,
			);

			const definition = manager.getDefinition(file, 10, 18);
			assertEquals(
				definition[0]?.range.start.line,
				3,
				"C# invocation should resolve to the method declaration",
			);

			const localDefinition = manager.getDefinition(file, 6, 12);
			assertEquals(
				localDefinition[0]?.range.start.line,
				4,
				"C# local identifier should resolve to the local declaration",
			);
		},
	);
});

test("TreeSitterManager: language-specific queries improve C++ navigation", async () => {
	await withTempDir(
		{
			"main.cpp": `class Greeter {
public:
  static const int Answer = 42;
};

int greet(int name) {
  auto local = name;
  return local;
}

int main() {
  int result = greet(1);
  return result;
}
`,
		},
		async (dir) => {
			const file = join(dir, "main.cpp");
			const manager = new TreeSitterManager();
			const symbols = manager.getDocumentSymbols(file).map((symbol) => symbol.name);
			assert(
				symbols.includes("Greeter") && symbols.includes("greet") && symbols.includes("main"),
				`Expected C++ symbols for class and functions, got: ${symbols.join(", ")}`,
			);

			const definition = manager.getDefinition(file, 12, 17);
			assertEquals(
				definition[0]?.range.start.line,
				5,
				"C++ call should resolve to the greet definition",
			);
		},
	);
});

test("TreeSitterManager: language-specific queries improve PowerShell navigation", async () => {
	await withTempDir(
		{
			"profile.ps1": `function GetGreeting($Name) { $local = $Name; return $local }
GetGreeting "world"
`,
		},
		async (dir) => {
			const file = join(dir, "profile.ps1");
			const manager = new TreeSitterManager();
			const symbols = manager.getDocumentSymbols(file).map((symbol) => symbol.name);
			assert(
				symbols.includes("GetGreeting"),
				`Expected PowerShell function symbol, got: ${symbols.join(", ")}`,
			);

			const definition = manager.getDefinition(file, 2, 2);
			assertEquals(
				definition[0]?.range.start.line,
				0,
				"PowerShell command should resolve to the function declaration",
			);
		},
	);
});

test("TreeSitterManager: language-specific queries improve Python locals", async () => {
	await withTempDir(
		{
			"app.py": `ANSWER = 42
def greet(name):
    local = name
    return local

greet("a")
`,
		},
		async (dir) => {
			const file = join(dir, "app.py");
			const manager = new TreeSitterManager();

			const localDefinition = manager.getDefinition(file, 4, 12);
			assertEquals(
				localDefinition[0]?.range.start.line,
				2,
				"Python local identifier should resolve to the assignment",
			);

			const references = manager.getReferences(file, 2, 5);
			assert(
				references.length >= 2,
				`Expected Python references for declaration plus call, got ${references.length}`,
			);
		},
	);
});

test("TreeSitterManager: query-backed symbols cover CSS, INI, and regex", async () => {
	await withTempDir(
		{
			"style.css": `.card { color: red; }
#app { display: flex; }
`,
			"config.ini": `[core]
name = value
path = /tmp
`,
			"pattern.regex": `^(foo|bar)+$
`,
		},
		async (dir) => {
			const manager = new TreeSitterManager();

			const cssSymbols = manager.getDocumentSymbols(join(dir, "style.css")).map((symbol) => symbol.name);
			assert(
				cssSymbols.includes(".card") && cssSymbols.includes("#app"),
				`Expected CSS selector symbols, got: ${cssSymbols.join(", ")}`,
			);

			const iniSymbols = manager.getDocumentSymbols(join(dir, "config.ini")).map((symbol) => symbol.name);
			assert(
				iniSymbols.includes("core") && iniSymbols.includes("name") && iniSymbols.includes("path"),
				`Expected INI section and setting symbols, got: ${iniSymbols.join(", ")}`,
			);

			const regexSymbols = manager.getDocumentSymbols(join(dir, "pattern.regex")).map((symbol) => symbol.name);
			assert(
				regexSymbols.some((symbol) => symbol.includes("foo") || symbol.includes("bar")),
				`Expected regex symbols from the pattern query, got: ${regexSymbols.join(", ")}`,
			);
		},
	);
});

test("LSPManager: falls back to Tree-sitter diagnostics without LSP root", async () => {
	await withTempDir(
		{
			"broken.ts": "const broken = ;\n",
		},
		async (dir) => {
			const manager = new LSPManager(dir);
			try {
				const result = await manager.touchFileAndWait(
					join(dir, "broken.ts"),
					1000,
				);
				assert(
					result.receivedResponse,
					"Expected fallback diagnostics to count as a response",
				);
				assert(
					!result.unsupported,
					`Expected Tree-sitter fallback instead of unsupported: ${result.error ?? ""}`,
				);
				assert(
					result.diagnostics.length > 0,
					"Expected fallback diagnostics for invalid TypeScript",
				);
			} finally {
				await manager.shutdown();
			}
		},
	);
});

test("LSPManager: uses Tree-sitter for document symbols and folding ranges", async () => {
	await withTempDir(
		{
			"main.py": `class Greeter:\n    def greet(self, name: str) -> str:\n        return \"hi \" + name\n`,
		},
		async (dir) => {
			const file = join(dir, "main.py");
			const manager = new LSPManager(dir);
			try {
				assert(
					await manager.supportsOperation(file, "documentSymbol"),
					"Expected documentSymbol fallback support",
				);
				assert(
					await manager.supportsOperation(file, "foldingRange"),
					"Expected foldingRange fallback support",
				);

				const symbols = await manager.getDocumentSymbols(file);
				assert(
					symbols.some((symbol) => symbol.name === "Greeter"),
					`Expected class symbol, got: ${symbols.map((symbol) => symbol.name).join(", ")}`,
				);
				assert(
					symbols.some((symbol) => symbol.name === "greet"),
					`Expected method symbol, got: ${symbols.map((symbol) => symbol.name).join(", ")}`,
				);

				const ranges = await manager.getFoldingRanges(file);
				assert(
					ranges.length > 0,
					"Expected folding ranges from Tree-sitter fallback",
				);
			} finally {
				await manager.shutdown();
			}
		},
	);
});

test("LSPManager: uses Tree-sitter for same-file definitions and references", async () => {
	await withTempDir(
		{
			"main.ts": `function greet(name: string) {\n  return name;\n}\n\nconst first = greet(\"a\");\nconst second = greet(\"b\");\n`,
		},
		async (dir) => {
			const file = join(dir, "main.ts");
			const manager = new LSPManager(dir);
			try {
				assert(
					await manager.supportsOperation(file, "goToDefinition"),
					"Expected definition fallback support",
				);
				assert(
					await manager.supportsOperation(file, "findReferences"),
					"Expected reference fallback support",
				);

				const definitions = await manager.getDefinition(file, 5, 15);
				assert(
					definitions.length > 0,
					"Expected same-file definition from Tree-sitter fallback",
				);
				assertEquals(
					definitions[0]?.range.start.line,
					0,
					"Definition should point to the function declaration",
				);

				const references = await manager.getReferences(file, 1, 10);
				assert(
					references.length >= 3,
					`Expected declaration plus two calls, got ${references.length}`,
				);
			} finally {
				await manager.shutdown();
			}
		},
	);
});

test("LSPManager: uses Tree-sitter for document highlights", async () => {
	await withTempDir(
		{
			"main.ts": `function greet(name: string) {
  return name;
}

const first = greet("a");
const second = greet("b");
`,
		},
		async (dir) => {
			const file = join(dir, "main.ts");
			const manager = new LSPManager(dir);
			try {
				assert(
					await manager.supportsOperation(file, "documentHighlight"),
					"Expected documentHighlight fallback support",
				);
				const highlights = await manager.getDocumentHighlights(file, 5, 15);
				assert(
					highlights.length >= 3,
					`Expected declaration plus two highlighted calls, got ${highlights.length}`,
				);
			} finally {
				await manager.shutdown();
			}
		},
	);
});

test("LSPManager: uses Tree-sitter for workspace symbols", async () => {
	await withTempDir(
		{
			"src/main.ts": `function greet(name: string) {
  return name;
}

export const answer = 42;
`,
			"src/helper.py": `class Helper:
    def ping(self):
        return "pong"
`,
		},
		async (dir) => {
			const file = join(dir, "src/main.ts");
			const manager = new LSPManager(dir);
			try {
				assert(
					await manager.supportsOperation(file, "workspaceSymbol"),
					"Expected workspaceSymbol fallback support",
				);
				assertEquals(
					await manager.getOperationBackend(file, "workspaceSymbol"),
					"tree-sitter",
				);

				const allSymbols = await manager.getWorkspaceSymbols(file);
				assert(
					allSymbols.some((symbol) => symbol.name === "greet"),
					`Expected workspace symbol for greet, got: ${allSymbols.map((symbol) => symbol.name).join(", ")}`,
				);
				assert(
					allSymbols.some((symbol) => symbol.name === "Helper"),
					`Expected workspace symbol for Helper, got: ${allSymbols.map((symbol) => symbol.name).join(", ")}`,
				);

				const filtered = await manager.getWorkspaceSymbols(file, "hel");
				assertEquals(
					filtered.length,
					1,
					`Expected one filtered workspace symbol, got ${filtered.length}`,
				);
				assertEquals(filtered[0]?.name, "Helper");
			} finally {
				await manager.shutdown();
			}
		},
	);
});

test("selectDevDocsDocsets: maps supported file types", async () => {
	assertEquals(
		JSON.stringify(selectDevDocsDocsets("src/index.ts")),
		JSON.stringify(["typescript", "javascript"]),
		"TypeScript should prefer typescript then javascript docsets",
	);
	assertEquals(
		JSON.stringify(selectDevDocsDocsets("src/index.js")),
		JSON.stringify(["javascript"]),
		"JavaScript should use javascript docset",
	);
	assertEquals(
		JSON.stringify(selectDevDocsDocsets("src/app.py")),
		JSON.stringify(["python~3.14"]),
		"Python should use the Python docset",
	);
});

test("extractDevDocsSymbolAtPosition: captures dotted symbol chains", async () => {
	await withTempDir(
		{
			"sample.ts": "const fn = Array.map;\n",
		},
		async (dir) => {
			const symbol = extractDevDocsSymbolAtPosition(
				join(dir, "sample.ts"),
				0,
				17,
			);
			assertEquals(
				symbol,
				"Array.map",
				"Expected dotted JavaScript symbol chain",
			);
		},
	);
});

test("findBestDevDocsEntry: prefers exact and member matches", async () => {
	const entry = findBestDevDocsEntry(
		[
			{ name: "Map", path: "global_objects/map", type: "Map" },
			{ name: "Array.map", path: "global_objects/array/map", type: "Array" },
			{
				name: "Iterator.map",
				path: "global_objects/iterator/map",
				type: "Iterator",
			},
		],
		"Array.map",
	);

	assertEquals(
		entry?.name,
		"Array.map",
		"Expected exact DevDocs match for Array.map",
	);
});

test("LSPManager: falls back to DevDocs hover when no hover is available", async () => {
	await withTempDir(
		{
			"sample.ts": "const fn = Array.map;\n",
		},
		async (dir) => {
			const originalFetch = globalThis.fetch;
			resetDevDocsCache();
			globalThis.fetch = (async () =>
				new Response(
					JSON.stringify({
						entries: [
							{
								name: "Array.map",
								path: "global_objects/array/map",
								type: "Array",
							},
						],
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				)) as typeof fetch;

			const manager = new LSPManager(dir);
			try {
				const hover = await manager.getHover(join(dir, "sample.ts"), 1, 18);
				assert(hover !== null, "Expected DevDocs hover fallback");
				const contents =
					typeof hover.contents === "string"
						? hover.contents
						: Array.isArray(hover.contents)
							? hover.contents
									.map((item) => (typeof item === "string" ? item : item.value))
									.join("\n")
							: hover.contents.value;
				assert(
					contents.includes("Documentation provider: DevDocs"),
					`Expected DevDocs provider marker, got: ${contents}`,
				);
				assert(
					contents.includes("Array.map"),
					`Expected matched entry name, got: ${contents}`,
				);
				assert(
					contents.includes("https://devdocs.io/") &&
						contents.includes("global_objects/array/map"),
					`Expected DevDocs URL, got: ${contents}`,
				);
			} finally {
				globalThis.fetch = originalFetch;
				resetDevDocsCache();
				await manager.shutdown();
			}
		},
	);
});

// ============================================================================
// Run tests
// ============================================================================

async function runTests(): Promise<void> {
	console.log("Running LSP tests...\n");

	const results: TestResult[] = [];
	let passed = 0;
	let failed = 0;

	for (const { name, fn } of tests) {
		try {
			await fn();
			results.push({ name, passed: true });
			console.log(`  ${name}... ✓`);
			passed++;
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			results.push({ name, passed: false, error: errorMsg });
			console.log(`  ${name}... ✗`);
			console.log(`    Error: ${errorMsg}\n`);
			failed++;
		}
	}

	console.log(`\n${passed} passed, ${failed} failed`);

	if (failed > 0) {
		process.exit(1);
	}
}

runTests();
