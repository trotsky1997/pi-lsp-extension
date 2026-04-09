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
import { ANALYZERS, getAnalyzerConfigsForFile, runAnalyzersForFile } from "../analyzer-core.js";
import { FORMATTERS, getFormatterConfigsForFile } from "../formatter-core.js";
import { LSPManager, LSP_SERVERS, LANGUAGE_IDS } from "../lsp-core.js";
import { loadResolvedLspSettings } from "../lsp-settings.js";
import { resolveLspUiState } from "../lsp.js";
import { TreeSitterManager } from "../tree-sitter-core.js";

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
    `${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`
  );
}

function assertIncludes(arr: string[], item: string, message: string) {
  assert(arr.includes(item), `${message}\nArray: [${arr.join(", ")}]\nMissing: ${item}`);
}

/** Create a temp directory with optional file structure */
async function withTempDir(
  structure: Record<string, string | null>, // null = directory, string = file content
  fn: (dir: string) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "lsp-test-"));
  try {
    for (const [path, content] of Object.entries(structure)) {
      const fullPath = join(dir, path);
      if (content === null) {
        await mkdir(fullPath, { recursive: true });
      } else {
        await mkdir(join(dir, path.split("/").slice(0, -1).join("/")), { recursive: true }).catch(() => {});
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
  assertEquals(LANGUAGE_IDS[".ts"], "typescript", ".ts should map to typescript");
  assertEquals(LANGUAGE_IDS[".tsx"], "typescriptreact", ".tsx should map to typescriptreact");
  assertEquals(LANGUAGE_IDS[".mts"], "typescript", ".mts should map to typescript");
  assertEquals(LANGUAGE_IDS[".cts"], "typescript", ".cts should map to typescript");
});

test("LANGUAGE_IDS: JavaScript extensions", async () => {
  assertEquals(LANGUAGE_IDS[".js"], "javascript", ".js should map to javascript");
  assertEquals(LANGUAGE_IDS[".jsx"], "javascriptreact", ".jsx should map to javascriptreact");
  assertEquals(LANGUAGE_IDS[".mjs"], "javascript", ".mjs should map to javascript");
  assertEquals(LANGUAGE_IDS[".cjs"], "javascript", ".cjs should map to javascript");
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
  assertEquals(LANGUAGE_IDS[".svelte"], "svelte", ".svelte should map to svelte");
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
  const server = LSP_SERVERS.find(s => s.id === "typescript");
  assert(server !== undefined, "Should have typescript server");
  assertIncludes(server!.extensions, ".ts", "Should handle .ts");
  assertIncludes(server!.extensions, ".tsx", "Should handle .tsx");
  assertIncludes(server!.extensions, ".js", "Should handle .js");
  assertIncludes(server!.extensions, ".jsx", "Should handle .jsx");
});

test("LSP_SERVERS: has Dart server", async () => {
  const server = LSP_SERVERS.find(s => s.id === "dart");
  assert(server !== undefined, "Should have dart server");
  assertIncludes(server!.extensions, ".dart", "Should handle .dart");
});

test("LSP_SERVERS: has Rust Analyzer server", async () => {
  const server = LSP_SERVERS.find(s => s.id === "rust-analyzer");
  assert(server !== undefined, "Should have rust-analyzer server");
  assertIncludes(server!.extensions, ".rs", "Should handle .rs");
});

test("LSP_SERVERS: has Gopls server", async () => {
  const server = LSP_SERVERS.find(s => s.id === "gopls");
  assert(server !== undefined, "Should have gopls server");
  assertIncludes(server!.extensions, ".go", "Should handle .go");
});

test("LSP_SERVERS: has Kotlin server", async () => {
  const server = LSP_SERVERS.find(s => s.id === "kotlin");
  assert(server !== undefined, "Should have kotlin server");
  assertIncludes(server!.extensions, ".kt", "Should handle .kt");
  assertIncludes(server!.extensions, ".kts", "Should handle .kts");
});

test("LSP_SERVERS: has Swift server", async () => {
  const server = LSP_SERVERS.find(s => s.id === "swift");
  assert(server !== undefined, "Should have swift server");
  assertIncludes(server!.extensions, ".swift", "Should handle .swift");
});

test("LSP_SERVERS: has Pyright server", async () => {
  const server = LSP_SERVERS.find(s => s.id === "pyright");
  assert(server !== undefined, "Should have pyright server");
  assertIncludes(server!.extensions, ".py", "Should handle .py");
  assertIncludes(server!.extensions, ".pyi", "Should handle .pyi");
});

test("LSP_SERVERS: has BasedPyright server", async () => {
  const server = LSP_SERVERS.find(s => s.id === "basedpyright");
  assert(server !== undefined, "Should have basedpyright server");
  assertIncludes(server!.extensions, ".py", "Should handle .py");
  assertIncludes(server!.extensions, ".pyi", "Should handle .pyi");
});

test("LSP_SERVERS: has Ty server", async () => {
  const server = LSP_SERVERS.find(s => s.id === "ty");
  assert(server !== undefined, "Should have ty server");
  assertIncludes(server!.extensions, ".py", "Should handle .py");
  assertIncludes(server!.extensions, ".pyi", "Should handle .pyi");
});

test("LSP_SERVERS: includes opencode-style built-ins", async () => {
  const ids = [
    "astro", "bash", "clangd", "deno", "eslint", "lua-ls", "markdown", "texlab",
    "nixd", "php", "prisma", "terraform", "tinymist", "yaml-ls", "zls",
  ];
  for (const id of ids) {
    assert(LSP_SERVERS.some((server) => server.id === id), `Should have ${id} server`);
  }
});

test("FORMATTERS: includes opencode-style built-ins", async () => {
  const ids = ["biome", "prettier", "rumdl", "ruff", "gofmt", "rustfmt", "shfmt", "terraform", "ktlint", "mix", "nixfmt", "zig"];
  for (const id of ids) {
    assert(FORMATTERS.some((formatter) => formatter.id === id), `Should have ${id} formatter`);
  }
});

test("ANALYZERS: includes semgrep", async () => {
  assert(ANALYZERS.some((analyzer) => analyzer.id === "semgrep"), "Should have semgrep analyzer");
});

test("ANALYZERS: includes common linter-style analyzers", async () => {
  const ids = ["ruff-check", "golangci-lint", "markdownlint", "lychee", "shellcheck", "hadolint", "slopgrep", "sloppylint", "karpeslop"];
  for (const id of ids) {
    assert(ANALYZERS.some((analyzer) => analyzer.id === id), `Should have ${id} analyzer`);
  }
});

test("markdown: uses workspace root", async () => {
  await withTempDir({
    "docs/guide.md": "# Guide",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "markdown")!;
    const root = server.findRoot(join(dir, "docs/guide.md"), dir, {});
    assertEquals(root, dir, "Markdown should use workspace root");
  });
});

test("texlab: finds root with texlabroot marker", async () => {
  await withTempDir({
    "paper/texlabroot": "",
    "paper/main.tex": "\\documentclass{article}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "texlab")!;
    const root = server.findRoot(join(dir, "paper/main.tex"), dir, {});
    assertEquals(root, join(dir, "paper"), "texlab should use texlabroot when present");
  });
});

// ============================================================================
// TypeScript root detection tests
// ============================================================================

test("typescript: finds root with package.json", async () => {
  await withTempDir({
    "package.json": "{}",
    "src/index.ts": "export const x = 1;",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const root = server.findRoot(join(dir, "src/index.ts"), dir, {});
    assertEquals(root, dir, "Should find root at package.json location");
  });
});

test("typescript: finds root with tsconfig.json", async () => {
  await withTempDir({
    "tsconfig.json": "{}",
    "src/index.ts": "export const x = 1;",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const root = server.findRoot(join(dir, "src/index.ts"), dir, {});
    assertEquals(root, dir, "Should find root at tsconfig.json location");
  });
});

test("typescript: finds root with jsconfig.json", async () => {
  await withTempDir({
    "jsconfig.json": "{}",
    "src/app.js": "const x = 1;",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const root = server.findRoot(join(dir, "src/app.js"), dir, {});
    assertEquals(root, dir, "Should find root at jsconfig.json location");
  });
});

test("typescript: returns undefined for deno projects", async () => {
  await withTempDir({
    "deno.json": "{}",
    "main.ts": "console.log('deno');",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const root = server.findRoot(join(dir, "main.ts"), dir, {});
    assertEquals(root, undefined, "Should return undefined for deno projects");
  });
});

test("typescript: nested package finds nearest root", async () => {
  await withTempDir({
    "package.json": "{}",
    "packages/web/package.json": "{}",
    "packages/web/src/index.ts": "export const x = 1;",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const root = server.findRoot(join(dir, "packages/web/src/index.ts"), dir, {});
    assertEquals(root, join(dir, "packages/web"), "Should find nearest package.json");
  });
});

// ============================================================================
// Dart root detection tests
// ============================================================================

test("dart: finds root with pubspec.yaml", async () => {
  await withTempDir({
    "pubspec.yaml": "name: my_app",
    "lib/main.dart": "void main() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "dart")!;
    const root = server.findRoot(join(dir, "lib/main.dart"), dir, {});
    assertEquals(root, dir, "Should find root at pubspec.yaml location");
  });
});

test("dart: finds root with analysis_options.yaml", async () => {
  await withTempDir({
    "analysis_options.yaml": "linter: rules:",
    "lib/main.dart": "void main() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "dart")!;
    const root = server.findRoot(join(dir, "lib/main.dart"), dir, {});
    assertEquals(root, dir, "Should find root at analysis_options.yaml location");
  });
});

test("dart: nested package finds nearest root", async () => {
  await withTempDir({
    "pubspec.yaml": "name: monorepo",
    "packages/core/pubspec.yaml": "name: core",
    "packages/core/lib/core.dart": "void init() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "dart")!;
    const root = server.findRoot(join(dir, "packages/core/lib/core.dart"), dir, {});
    assertEquals(root, join(dir, "packages/core"), "Should find nearest pubspec.yaml");
  });
});

// ============================================================================
// Rust root detection tests
// ============================================================================

test("rust: finds root with Cargo.toml", async () => {
  await withTempDir({
    "Cargo.toml": "[package]\nname = \"my_crate\"",
    "src/lib.rs": "pub fn hello() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "rust-analyzer")!;
    const root = server.findRoot(join(dir, "src/lib.rs"), dir, {});
    assertEquals(root, dir, "Should find root at Cargo.toml location");
  });
});

test("rust: nested workspace member finds nearest Cargo.toml", async () => {
  await withTempDir({
    "Cargo.toml": "[workspace]\nmembers = [\"crates/*\"]",
    "crates/core/Cargo.toml": "[package]\nname = \"core\"",
    "crates/core/src/lib.rs": "pub fn init() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "rust-analyzer")!;
    const root = server.findRoot(join(dir, "crates/core/src/lib.rs"), dir, {});
    assertEquals(root, join(dir, "crates/core"), "Should find nearest Cargo.toml");
  });
});

// ============================================================================
// Go root detection tests (including gopls bug fix verification)
// ============================================================================

test("gopls: finds root with go.mod", async () => {
  await withTempDir({
    "go.mod": "module example.com/myapp",
    "main.go": "package main",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "gopls")!;
    const root = server.findRoot(join(dir, "main.go"), dir, {});
    assertEquals(root, dir, "Should find root at go.mod location");
  });
});

test("gopls: finds root with go.work (workspace)", async () => {
  await withTempDir({
    "go.work": "go 1.21\nuse ./app",
    "app/go.mod": "module example.com/app",
    "app/main.go": "package main",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "gopls")!;
    const root = server.findRoot(join(dir, "app/main.go"), dir, {});
    assertEquals(root, dir, "Should find root at go.work location (workspace root)");
  });
});

test("gopls: prefers go.work over go.mod", async () => {
  await withTempDir({
    "go.work": "go 1.21\nuse ./app",
    "go.mod": "module example.com/root",
    "app/go.mod": "module example.com/app",
    "app/main.go": "package main",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "gopls")!;
    const root = server.findRoot(join(dir, "app/main.go"), dir, {});
    // go.work is found first, so it should return the go.work location
    assertEquals(root, dir, "Should prefer go.work over go.mod");
  });
});

test("gopls: returns undefined when no go.mod or go.work (bug fix verification)", async () => {
  await withTempDir({
    "main.go": "package main",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "gopls")!;
    const root = server.findRoot(join(dir, "main.go"), dir, {});
    // This test verifies the bug fix: previously this would return undefined
    // because `undefined !== cwd` was true, skipping the go.mod check
    assertEquals(root, undefined, "Should return undefined when no go.mod or go.work");
  });
});

test("gopls: finds go.mod when go.work not present (bug fix verification)", async () => {
  await withTempDir({
    "go.mod": "module example.com/myapp",
    "cmd/server/main.go": "package main",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "gopls")!;
    const root = server.findRoot(join(dir, "cmd/server/main.go"), dir, {});
    // This is the key test for the bug fix
    // Previously: findRoot(go.work) returns undefined, then `undefined !== cwd` is true,
    // so it would return undefined without checking go.mod
    // After fix: if go.work not found, falls through to check go.mod
    assertEquals(root, dir, "Should find go.mod when go.work is not present");
  });
});

// ============================================================================
// Kotlin root detection tests
// ============================================================================

test("kotlin: finds root with settings.gradle.kts", async () => {
  await withTempDir({
    "settings.gradle.kts": "rootProject.name = \"myapp\"",
    "app/src/main/kotlin/Main.kt": "fun main() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "kotlin")!;
    const root = server.findRoot(join(dir, "app/src/main/kotlin/Main.kt"), dir, {});
    assertEquals(root, dir, "Should find root at settings.gradle.kts location");
  });
});

test("kotlin: prefers settings.gradle(.kts) over nested build.gradle", async () => {
  await withTempDir({
    "settings.gradle": "rootProject.name = 'root'",
    "app/build.gradle": "plugins {}",
    "app/src/main/kotlin/Main.kt": "fun main() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "kotlin")!;
    const root = server.findRoot(join(dir, "app/src/main/kotlin/Main.kt"), dir, {});
    assertEquals(root, dir, "Should prefer settings.gradle at workspace root");
  });
});

test("kotlin: finds root with pom.xml", async () => {
  await withTempDir({
    "pom.xml": "<project></project>",
    "src/main/kotlin/Main.kt": "fun main() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "kotlin")!;
    const root = server.findRoot(join(dir, "src/main/kotlin/Main.kt"), dir, {});
    assertEquals(root, dir, "Should find root at pom.xml location");
  });
});

// ============================================================================
// Swift root detection tests
// ============================================================================

test("swift: finds root with Package.swift", async () => {
  await withTempDir({
    "Package.swift": "// swift-tools-version: 5.9",
    "Sources/App/main.swift": "print(\"hi\")",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "swift")!;
    const root = server.findRoot(join(dir, "Sources/App/main.swift"), dir, {});
    assertEquals(root, dir, "Should find root at Package.swift location");
  });
});

test("swift: finds root with Xcode project", async () => {
  await withTempDir({
    "MyApp.xcodeproj/project.pbxproj": "// pbxproj",
    "MyApp/main.swift": "print(\"hi\")",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "swift")!;
    const root = server.findRoot(join(dir, "MyApp/main.swift"), dir, {});
    assertEquals(root, dir, "Should find root at Xcode project location");
  });
});

test("swift: finds root with Xcode workspace", async () => {
  await withTempDir({
    "MyApp.xcworkspace/contents.xcworkspacedata": "<Workspace/>",
    "MyApp/main.swift": "print(\"hi\")",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "swift")!;
    const root = server.findRoot(join(dir, "MyApp/main.swift"), dir, {});
    assertEquals(root, dir, "Should find root at Xcode workspace location");
  });
});

// ============================================================================
// Python root detection tests
// ============================================================================

test("pyright: finds root with pyproject.toml", async () => {
  await withTempDir({
    "pyproject.toml": "[project]\nname = \"myapp\"",
    "src/main.py": "print('hello')",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "pyright")!;
    const root = server.findRoot(join(dir, "src/main.py"), dir, {});
    assertEquals(root, dir, "Should find root at pyproject.toml location");
  });
});

test("pyright: finds root with setup.py", async () => {
  await withTempDir({
    "setup.py": "from setuptools import setup",
    "myapp/main.py": "print('hello')",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "pyright")!;
    const root = server.findRoot(join(dir, "myapp/main.py"), dir, {});
    assertEquals(root, dir, "Should find root at setup.py location");
  });
});

test("pyright: finds root with requirements.txt", async () => {
  await withTempDir({
    "requirements.txt": "flask>=2.0",
    "app.py": "from flask import Flask",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "pyright")!;
    const root = server.findRoot(join(dir, "app.py"), dir, {});
    assertEquals(root, dir, "Should find root at requirements.txt location");
  });
});

// ============================================================================
// URI construction tests (pathToFileURL)
// ============================================================================

test("pathToFileURL: handles simple paths", async () => {
  const uri = pathToFileURL("/home/user/project/file.ts").href;
  assertEquals(uri, "file:///home/user/project/file.ts", "Should create proper file URI");
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
  await withTempDir({
    "package.json": "{}",
    "src/App.vue": "<template></template>",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "vue")!;
    const root = server.findRoot(join(dir, "src/App.vue"), dir, {});
    assertEquals(root, dir, "Should find root at package.json location");
  });
});

test("vue: finds root with vite.config.ts", async () => {
  await withTempDir({
    "vite.config.ts": "export default {}",
    "src/App.vue": "<template></template>",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "vue")!;
    const root = server.findRoot(join(dir, "src/App.vue"), dir, {});
    assertEquals(root, dir, "Should find root at vite.config.ts location");
  });
});

test("svelte: finds root with svelte.config.js", async () => {
  await withTempDir({
    "svelte.config.js": "export default {}",
    "src/App.svelte": "<script></script>",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "svelte")!;
    const root = server.findRoot(join(dir, "src/App.svelte"), dir, {});
    assertEquals(root, dir, "Should find root at svelte.config.js location");
  });
});

// ============================================================================
// Additional Rust tests (parity with TypeScript)
// ============================================================================

test("rust: finds root in src subdirectory", async () => {
  await withTempDir({
    "Cargo.toml": "[package]\nname = \"myapp\"",
    "src/main.rs": "fn main() {}",
    "src/lib.rs": "pub mod utils;",
    "src/utils/mod.rs": "pub fn helper() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "rust-analyzer")!;
    const root = server.findRoot(join(dir, "src/utils/mod.rs"), dir, {});
    assertEquals(root, dir, "Should find root from deeply nested src file");
  });
});

test("rust: workspace with multiple crates", async () => {
  await withTempDir({
    "Cargo.toml": "[workspace]\nmembers = [\"crates/*\"]",
    "crates/api/Cargo.toml": "[package]\nname = \"api\"",
    "crates/api/src/lib.rs": "pub fn serve() {}",
    "crates/core/Cargo.toml": "[package]\nname = \"core\"",
    "crates/core/src/lib.rs": "pub fn init() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "rust-analyzer")!;
    // Each crate should find its own Cargo.toml
    const apiRoot = server.findRoot(join(dir, "crates/api/src/lib.rs"), dir, {});
    const coreRoot = server.findRoot(join(dir, "crates/core/src/lib.rs"), dir, {});
    assertEquals(apiRoot, join(dir, "crates/api"), "API crate should find its Cargo.toml");
    assertEquals(coreRoot, join(dir, "crates/core"), "Core crate should find its Cargo.toml");
  });
});

test("rust: returns undefined when no Cargo.toml", async () => {
  await withTempDir({
    "main.rs": "fn main() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "rust-analyzer")!;
    const root = server.findRoot(join(dir, "main.rs"), dir, {});
    assertEquals(root, undefined, "Should return undefined when no Cargo.toml");
  });
});

// ============================================================================
// Additional Dart tests (parity with TypeScript)
// ============================================================================

test("dart: Flutter project with pubspec.yaml", async () => {
  await withTempDir({
    "pubspec.yaml": "name: my_flutter_app\ndependencies:\n  flutter:\n    sdk: flutter",
    "lib/main.dart": "import 'package:flutter/material.dart';",
    "lib/screens/home.dart": "class HomeScreen {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "dart")!;
    const root = server.findRoot(join(dir, "lib/screens/home.dart"), dir, {});
    assertEquals(root, dir, "Should find root for Flutter project");
  });
});

test("dart: returns undefined when no marker files", async () => {
  await withTempDir({
    "main.dart": "void main() {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "dart")!;
    const root = server.findRoot(join(dir, "main.dart"), dir, {});
    assertEquals(root, undefined, "Should return undefined when no pubspec.yaml or analysis_options.yaml");
  });
});

test("dart: monorepo with multiple packages", async () => {
  await withTempDir({
    "pubspec.yaml": "name: monorepo",
    "packages/auth/pubspec.yaml": "name: auth",
    "packages/auth/lib/auth.dart": "class Auth {}",
    "packages/ui/pubspec.yaml": "name: ui",
    "packages/ui/lib/widgets.dart": "class Button {}",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "dart")!;
    const authRoot = server.findRoot(join(dir, "packages/auth/lib/auth.dart"), dir, {});
    const uiRoot = server.findRoot(join(dir, "packages/ui/lib/widgets.dart"), dir, {});
    assertEquals(authRoot, join(dir, "packages/auth"), "Auth package should find its pubspec");
    assertEquals(uiRoot, join(dir, "packages/ui"), "UI package should find its pubspec");
  });
});

// ============================================================================
// Additional Python tests (parity with TypeScript)
// ============================================================================

test("pyright: finds root with pyrightconfig.json", async () => {
  await withTempDir({
    "pyrightconfig.json": "{}",
    "src/app.py": "print('hello')",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "pyright")!;
    const root = server.findRoot(join(dir, "src/app.py"), dir, {});
    assertEquals(root, dir, "Should find root at pyrightconfig.json location");
  });
});

test("pyright: returns undefined when no marker files", async () => {
  await withTempDir({
    "script.py": "print('hello')",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "pyright")!;
    const root = server.findRoot(join(dir, "script.py"), dir, {});
    assertEquals(root, undefined, "Should return undefined when no Python project markers");
  });
});

test("pyright: monorepo with multiple packages", async () => {
  await withTempDir({
    "pyproject.toml": "[project]\nname = \"monorepo\"",
    "packages/api/pyproject.toml": "[project]\nname = \"api\"",
    "packages/api/src/main.py": "from flask import Flask",
    "packages/worker/pyproject.toml": "[project]\nname = \"worker\"",
    "packages/worker/src/tasks.py": "def process(): pass",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "pyright")!;
    const apiRoot = server.findRoot(join(dir, "packages/api/src/main.py"), dir, {});
    const workerRoot = server.findRoot(join(dir, "packages/worker/src/tasks.py"), dir, {});
    assertEquals(apiRoot, join(dir, "packages/api"), "API package should find its pyproject.toml");
    assertEquals(workerRoot, join(dir, "packages/worker"), "Worker package should find its pyproject.toml");
  });
});

test("basedpyright: finds root with basedpyrightconfig.json", async () => {
  await withTempDir({
    "basedpyrightconfig.json": "{}",
    "src/app.py": "print('hello')",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "basedpyright")!;
    const root = server.findRoot(join(dir, "src/app.py"), dir, {});
    assertEquals(root, dir, "Should find root at basedpyrightconfig.json location");
  });
});

test("ty: finds root with ty.toml", async () => {
  await withTempDir({
    "ty.toml": "[tool.ty]",
    "src/app.py": "print('hello')",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "ty")!;
    const root = server.findRoot(join(dir, "src/app.py"), dir, {});
    assertEquals(root, dir, "Should find root at ty.toml location");
  });
});

test("ty: falls back to pyproject.toml", async () => {
  await withTempDir({
    "pyproject.toml": "[project]\nname = \"app\"",
    "src/app.py": "print('hello')",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "ty")!;
    const root = server.findRoot(join(dir, "src/app.py"), dir, {});
    assertEquals(root, dir, "Should still find root at pyproject.toml location");
  });
});

// ============================================================================
// Additional Go tests
// ============================================================================

test("gopls: monorepo with multiple modules", async () => {
  await withTempDir({
    "go.work": "go 1.21\nuse (\n  ./api\n  ./worker\n)",
    "api/go.mod": "module example.com/api",
    "api/main.go": "package main",
    "worker/go.mod": "module example.com/worker",
    "worker/main.go": "package main",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "gopls")!;
    // With go.work present, all files should use workspace root
    const apiRoot = server.findRoot(join(dir, "api/main.go"), dir, {});
    const workerRoot = server.findRoot(join(dir, "worker/main.go"), dir, {});
    assertEquals(apiRoot, dir, "API module should use go.work root");
    assertEquals(workerRoot, dir, "Worker module should use go.work root");
  });
});

test("gopls: nested cmd directory", async () => {
  await withTempDir({
    "go.mod": "module example.com/myapp",
    "cmd/server/main.go": "package main",
    "cmd/cli/main.go": "package main",
    "internal/db/db.go": "package db",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "gopls")!;
    const serverRoot = server.findRoot(join(dir, "cmd/server/main.go"), dir, {});
    const cliRoot = server.findRoot(join(dir, "cmd/cli/main.go"), dir, {});
    const dbRoot = server.findRoot(join(dir, "internal/db/db.go"), dir, {});
    assertEquals(serverRoot, dir, "cmd/server should find go.mod at root");
    assertEquals(cliRoot, dir, "cmd/cli should find go.mod at root");
    assertEquals(dbRoot, dir, "internal/db should find go.mod at root");
  });
});

// ============================================================================
// Additional TypeScript tests
// ============================================================================

test("typescript: pnpm workspace", async () => {
  await withTempDir({
    "package.json": "{}",
    "pnpm-workspace.yaml": "packages:\n  - packages/*",
    "packages/web/package.json": "{}",
    "packages/web/src/App.tsx": "export const App = () => null;",
    "packages/api/package.json": "{}",
    "packages/api/src/index.ts": "export const handler = () => {};",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const webRoot = server.findRoot(join(dir, "packages/web/src/App.tsx"), dir, {});
    const apiRoot = server.findRoot(join(dir, "packages/api/src/index.ts"), dir, {});
    assertEquals(webRoot, join(dir, "packages/web"), "Web package should find its package.json");
    assertEquals(apiRoot, join(dir, "packages/api"), "API package should find its package.json");
  });
});

test("typescript: returns undefined when no config files", async () => {
  await withTempDir({
    "script.ts": "const x = 1;",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const root = server.findRoot(join(dir, "script.ts"), dir, {});
    assertEquals(root, undefined, "Should return undefined when no package.json or tsconfig.json");
  });
});

test("typescript: prefers nearest tsconfig over package.json", async () => {
  await withTempDir({
    "package.json": "{}",
    "apps/web/tsconfig.json": "{}",
    "apps/web/src/index.ts": "export const x = 1;",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const root = server.findRoot(join(dir, "apps/web/src/index.ts"), dir, {});
    // Should find tsconfig.json first (it's nearer than root package.json)
    assertEquals(root, join(dir, "apps/web"), "Should find nearest config file");
  });
});

// ============================================================================
// Additional Vue/Svelte tests
// ============================================================================

test("vue: Nuxt project", async () => {
  await withTempDir({
    "package.json": "{}",
    "nuxt.config.ts": "export default {}",
    "pages/index.vue": "<template></template>",
    "components/Button.vue": "<template></template>",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "vue")!;
    const pagesRoot = server.findRoot(join(dir, "pages/index.vue"), dir, {});
    const componentsRoot = server.findRoot(join(dir, "components/Button.vue"), dir, {});
    assertEquals(pagesRoot, dir, "Pages should find root");
    assertEquals(componentsRoot, dir, "Components should find root");
  });
});

test("vue: returns undefined when no config", async () => {
  await withTempDir({
    "App.vue": "<template></template>",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "vue")!;
    const root = server.findRoot(join(dir, "App.vue"), dir, {});
    assertEquals(root, undefined, "Should return undefined when no package.json or vite.config");
  });
});

test("svelte: SvelteKit project", async () => {
  await withTempDir({
    "package.json": "{}",
    "svelte.config.js": "export default {}",
    "src/routes/+page.svelte": "<script></script>",
    "src/lib/components/Button.svelte": "<script></script>",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "svelte")!;
    const routeRoot = server.findRoot(join(dir, "src/routes/+page.svelte"), dir, {});
    const libRoot = server.findRoot(join(dir, "src/lib/components/Button.svelte"), dir, {});
    assertEquals(routeRoot, dir, "Route should find root");
    assertEquals(libRoot, dir, "Lib component should find root");
  });
});

test("svelte: returns undefined when no config", async () => {
  await withTempDir({
    "App.svelte": "<script></script>",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "svelte")!;
    const root = server.findRoot(join(dir, "App.svelte"), dir, {});
    assertEquals(root, undefined, "Should return undefined when no package.json or svelte.config.js");
  });
});

// ============================================================================
// Stop boundary tests (findNearestFile respects cwd boundary)
// ============================================================================

test("stop boundary: does not search above cwd", async () => {
  await withTempDir({
    "package.json": "{}", // This is at root
    "projects/myapp/src/index.ts": "export const x = 1;",
    // Note: no package.json in projects/myapp
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    // When cwd is set to projects/myapp, it should NOT find the root package.json
    const projectDir = join(dir, "projects/myapp");
    const root = server.findRoot(join(projectDir, "src/index.ts"), projectDir, {});
    assertEquals(root, undefined, "Should not find package.json above cwd boundary");
  });
});

test("stop boundary: finds marker at cwd level", async () => {
  await withTempDir({
    "projects/myapp/package.json": "{}",
    "projects/myapp/src/index.ts": "export const x = 1;",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const projectDir = join(dir, "projects/myapp");
    const root = server.findRoot(join(projectDir, "src/index.ts"), projectDir, {});
    assertEquals(root, projectDir, "Should find package.json at cwd level");
  });
});

// ============================================================================
// Edge cases
// ============================================================================

test("edge: deeply nested file finds correct root", async () => {
  await withTempDir({
    "package.json": "{}",
    "src/components/ui/buttons/primary/Button.tsx": "export const Button = () => null;",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const root = server.findRoot(join(dir, "src/components/ui/buttons/primary/Button.tsx"), dir, {});
    assertEquals(root, dir, "Should find root even for deeply nested files");
  });
});

test("edge: file at root level finds root", async () => {
  await withTempDir({
    "package.json": "{}",
    "index.ts": "console.log('root');",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const root = server.findRoot(join(dir, "index.ts"), dir, {});
    assertEquals(root, dir, "Should find root for file at root level");
  });
});

test("edge: no marker files returns undefined", async () => {
  await withTempDir({
    "random.ts": "const x = 1;",
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const root = server.findRoot(join(dir, "random.ts"), dir, {});
    assertEquals(root, undefined, "Should return undefined when no marker files");
  });
});

// ============================================================================
// Settings tests
// ============================================================================

test("settings: project server config overrides global config", async () => {
  await withTempDir({
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
            workspaceConfiguration: { typescript: { format: { semicolons: "remove" } } },
          },
        },
      },
    }),
  }, async (dir) => {
    const settings = loadResolvedLspSettings(dir, {
      globalSettingsPath: join(dir, "global-settings.json"),
      projectSettingsPath: join(dir, ".pi/settings.json"),
    });

    assertEquals(settings.servers.typescript?.command, "project-tsls", "Project command should override global command");
    assertEquals(settings.servers.typescript?.args?.[0], "--stdio", "Global args should be preserved when project omits them");
    assertEquals(settings.servers.typescript?.env?.GLOBAL_FLAG, "1", "Global env should be retained");
    assertEquals(settings.servers.typescript?.env?.PROJECT_FLAG, "1", "Project env should merge in");
    assertEquals((settings.servers.typescript?.initializationOptions as any)?.hostInfo, "global", "Global initialization options should remain");
    assertEquals((settings.servers.typescript?.workspaceConfiguration as any)?.typescript?.format?.semicolons, "remove", "Project workspace configuration should be applied");
  });
});

test("settings: custom root markers override defaults", async () => {
  await withTempDir({
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
  }, async (dir) => {
    const server = LSP_SERVERS.find(s => s.id === "typescript")!;
    const settings = loadResolvedLspSettings(dir, {
      projectSettingsPath: join(dir, ".pi/settings.json"),
      globalSettingsPath: join(dir, "missing-global.json"),
    });
    const root = server.findRoot(join(dir, "src/index.ts"), dir, settings.servers.typescript ?? {});
    assertEquals(root, dir, "Custom root marker should be honored");
  });
});

test("settings: python provider and hook mode merge project over global", async () => {
  await withTempDir({
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
  }, async (dir) => {
    const settings = loadResolvedLspSettings(dir, {
      globalSettingsPath: join(dir, "global-settings.json"),
      projectSettingsPath: join(dir, ".pi/settings.json"),
    });

    assertEquals(settings.hookMode, "agent_end", "Project hook mode should override global hook mode");
    assertEquals(settings.pythonProvider, "ty", "Project provider should override global provider");
  });
});

test("settings: formatter config merges project over global", async () => {
  await withTempDir({
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
  }, async (dir) => {
    const settings = loadResolvedLspSettings(dir, {
      globalSettingsPath: join(dir, "global-settings.json"),
      projectSettingsPath: join(dir, ".pi/settings.json"),
    });

    assertEquals(settings.formatterHookMode, "edit_write", "Project formatter hook mode should override global formatter hook mode");
    assertEquals(settings.formatters.prettier?.disabled, true, "Project formatter overrides should be applied");
    assertEquals(settings.formatters.prettier?.env?.PRETTIERD_DEFAULT_CONFIG, "/tmp/prettier.json", "Formatter env should merge from global settings");
    assertEquals(settings.formatters.ruff?.command, "ruff", "Project-only formatter should be included");
  });
});

test("settings: analyzer config merges project over global", async () => {
  await withTempDir({
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
  }, async (dir) => {
    const settings = loadResolvedLspSettings(dir, {
      globalSettingsPath: join(dir, "global-settings.json"),
      projectSettingsPath: join(dir, ".pi/settings.json"),
    });

    assertEquals(settings.analyzerHookMode, "edit_write", "Project analyzer hook mode should override global analyzer hook mode");
    assertEquals(settings.analyzers.semgrep?.disabled, true, "Project analyzer overrides should be applied");
    assertEquals(settings.analyzers.semgrep?.env?.SEMGREP_APP_TOKEN, "global", "Analyzer env should merge from global settings");
  });
});

test("formatter matching: project settings can disable specific formatter", async () => {
  await withTempDir({
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
  }, async (dir) => {
    const matches = getFormatterConfigsForFile(join(dir, "src/index.ts"), dir);
    assert(matches.some((formatter) => formatter.id === "prettier"), "Prettier should still match");
    assert(!matches.some((formatter) => formatter.id === "biome"), "Biome should be excluded when disabled in settings");
  });
});

test("formatter matching: rumdl matches markdown files", async () => {
  await withTempDir({
    "docs/guide.md": "# Guide",
  }, async (dir) => {
    const matches = getFormatterConfigsForFile(join(dir, "docs/guide.md"), dir);
    assert(matches.some((formatter) => formatter.id === "rumdl"), "rumdl should match markdown files");
  });
});

test("formatter matching: markdown prefers rumdl and avoids biome", async () => {
  await withTempDir({
    "docs/guide.md": "# Guide",
  }, async (dir) => {
    const matches = getFormatterConfigsForFile(join(dir, "docs/guide.md"), dir);
    assertEquals(matches[0]?.id, "rumdl", "Markdown should prefer rumdl first");
    assert(matches.some((formatter) => formatter.id === "prettier"), "prettier should remain available as a fallback for markdown");
    assert(!matches.some((formatter) => formatter.id === "biome"), "biome should not claim markdown files");
  });
});

test("analyzer matching: semgrep matches supported files", async () => {
  await withTempDir({
    "src/index.ts": "export const x = 1;",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "src/index.ts"), dir);
    assert(matches.some((analyzer) => analyzer.id === "semgrep"), "semgrep should match ts files");
  });
});

test("analyzer matching: ruff-check matches python files", async () => {
  await withTempDir({
    "src/app.py": "print('hello')",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "src/app.py"), dir);
    assert(matches.some((analyzer) => analyzer.id === "ruff-check"), "ruff-check should match python files");
  });
});

test("analyzer matching: golangci-lint matches go files", async () => {
  await withTempDir({
    "main.go": "package main",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "main.go"), dir);
    assert(matches.some((analyzer) => analyzer.id === "golangci-lint"), "golangci-lint should match go files");
  });
});

test("analyzer matching: markdownlint matches markdown files", async () => {
  await withTempDir({
    "README.md": "# hello",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "README.md"), dir);
    assert(matches.some((analyzer) => analyzer.id === "markdownlint"), "markdownlint should match markdown files");
  });
});

test("analyzer matching: lychee matches markdown files", async () => {
  await withTempDir({
    "README.md": "# hello",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "README.md"), dir);
    assert(matches.some((analyzer) => analyzer.id === "lychee"), "lychee should match markdown files");
  });
});

test("analyzer matching: lychee matches html files", async () => {
  await withTempDir({
    "site/index.html": '<a href="https://example.invalid/docs">broken</a>',
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "site/index.html"), dir);
    assert(matches.some((analyzer) => analyzer.id === "lychee"), "lychee should match html files");
  });
});

test("analyzer matching: slopgrep matches prose files", async () => {
  await withTempDir({
    "docs/notes.md": "Here is a note.",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "docs/notes.md"), dir);
    assert(matches.some((analyzer) => analyzer.id === "slopgrep"), "slopgrep should match markdown files");
  });
});

test("analyzer matching: slopgrep matches tex files", async () => {
  await withTempDir({
    "paper/main.tex": "\\section{Intro}",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "paper/main.tex"), dir);
    assert(matches.some((analyzer) => analyzer.id === "slopgrep"), "slopgrep should match tex files");
  });
});

test("analyzer matching: shellcheck matches shell files", async () => {
  await withTempDir({
    "script.sh": "echo hi",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "script.sh"), dir);
    assert(matches.some((analyzer) => analyzer.id === "shellcheck"), "shellcheck should match shell files");
  });
});

test("analyzer matching: sloppylint matches python files", async () => {
  await withTempDir({
    "src/app.py": "print('hello')",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "src/app.py"), dir);
    assert(matches.some((analyzer) => analyzer.id === "sloppylint"), "sloppylint should match python files");
  });
});

test("analyzer matching: karpeslop matches ts files", async () => {
  await withTempDir({
    "src/app.ts": "export const x = 1;",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "src/app.ts"), dir);
    assert(matches.some((analyzer) => analyzer.id === "karpeslop"), "karpeslop should match ts files");
  });
});

test("analyzer matching: hadolint matches Dockerfile", async () => {
  await withTempDir({
    "Dockerfile": "FROM alpine:latest",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "Dockerfile"), dir);
    assert(matches.some((analyzer) => analyzer.id === "hadolint"), "hadolint should match Dockerfile");
  });
});

test("analyzer matching: project settings can disable semgrep", async () => {
  await withTempDir({
    ".pi": null,
    ".pi/settings.json": JSON.stringify({
      analyzer: {
        analyzers: {
          semgrep: { disabled: true },
        },
      },
    }),
    "src/index.ts": "export const x = 1;",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "src/index.ts"), dir);
    assert(!matches.some((analyzer) => analyzer.id === "semgrep"), "semgrep should be excluded when disabled in settings");
  });
});

test("analyzer matching: multiple analyzers can match one python file", async () => {
  await withTempDir({
    "src/app.py": "print('hello')",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "src/app.py"), dir);
    assert(matches.some((analyzer) => analyzer.id === "ruff-check"), "ruff-check should match python files");
    assert(matches.some((analyzer) => analyzer.id === "sloppylint"), "sloppylint should also match python files");
  });
});

test("analyzer matching: multiple analyzers can match one ts file", async () => {
  await withTempDir({
    "src/app.ts": "export const x = 1;",
  }, async (dir) => {
    const matches = getAnalyzerConfigsForFile(join(dir, "src/app.ts"), dir);
    assert(matches.some((analyzer) => analyzer.id === "semgrep"), "semgrep should match ts files");
    assert(matches.some((analyzer) => analyzer.id === "karpeslop"), "karpeslop should also match ts files");
  });
});

test("runAnalyzersForFile: lychee maps broken links back to source lines", async () => {
  await withTempDir({
    ".pi": null,
    "docs/README.md": "[good](https://example.com)\n[broken](https://example.invalid/docs)\n",
  }, async (dir) => {
    const fakeLychee = join(dir, "fake-lychee.sh");
    await writeFile(fakeLychee, `#!/bin/sh
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
`);
    await chmod(fakeLychee, 0o755);
    await writeFile(join(dir, ".pi/settings.json"), JSON.stringify({
      analyzer: {
        analyzers: {
          lychee: { command: fakeLychee },
          markdownlint: { disabled: true },
          slopgrep: { disabled: true },
        },
      },
    }));

    const result = await runAnalyzersForFile(join(dir, "docs/README.md"), dir);
    assertIncludes(result.analyzerIds ?? [], "lychee", "lychee should be reported as the analyzer that ran");
    assertEquals(result.findings.length, 1, "Expected one lychee finding");
    assertEquals(result.findings[0]?.line, 2, "Broken link should map to the second line");
    assertEquals(result.findings[0]?.column, 10, "Broken link should map to the URL column");
    assert(result.findings[0]?.message.includes("404 Not Found"), `Expected lychee message to include HTTP details, got ${result.findings[0]?.message}`);
  });
});

test("runAnalyzersForFile: markdownlint parses JSON findings from stderr", async () => {
  await withTempDir({
    ".pi": null,
    "docs/README.md": "# Title\n## Section\n",
  }, async (dir) => {
    const fakeMarkdownlint = join(dir, "fake-markdownlint.sh");
    await writeFile(fakeMarkdownlint, `#!/bin/sh
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
`);
    await chmod(fakeMarkdownlint, 0o755);
    await writeFile(join(dir, ".pi/settings.json"), JSON.stringify({
      analyzer: {
        analyzers: {
          semgrep: { disabled: true },
          lychee: { disabled: true },
          slopgrep: { disabled: true },
          markdownlint: { command: fakeMarkdownlint },
        },
      },
    }));

    const result = await runAnalyzersForFile(join(dir, "docs/README.md"), dir);
    assertIncludes(result.analyzerIds ?? [], "markdownlint", "markdownlint should be reported as the analyzer that ran");
    assertEquals(result.findings.length, 1, "Expected one markdownlint finding");
    assertEquals(result.findings[0]?.source, "markdownlint", "Expected markdownlint finding source");
    assertEquals(result.findings[0]?.line, 2, "Expected markdownlint line number from stderr JSON");
    assert(!result.error, `Did not expect stderr JSON to be treated as an analyzer error: ${result.error ?? ""}`);
  });
});

test("resolveLspUiState: session override beats disk settings", async () => {
  await withTempDir({
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
  }, async (dir) => {
    const resolved = resolveLspUiState(dir, {
      scope: "session",
      hookMode: "edit_write",
      pythonProvider: "basedpyright",
    }, join(dir, "global-settings.json"));

    assertEquals(resolved.hookMode, "edit_write", "Session hook mode should win");
    assertEquals(resolved.hookScope, "session", "Hook scope should be session");
    assertEquals(resolved.pythonProvider, "basedpyright", "Session provider should win");
    assertEquals(resolved.pythonScope, "session", "Python scope should be session");
  });
});

test("resolveLspUiState: project scope is reported from disk settings", async () => {
  await withTempDir({
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
  }, async (dir) => {
    const resolved = resolveLspUiState(dir, {
      scope: "project",
      hookMode: "agent_end",
      pythonProvider: "ty",
    }, join(dir, "global-settings.json"));

    assertEquals(resolved.hookMode, "agent_end", "Project hook mode should come from disk");
    assertEquals(resolved.hookScope, "project", "Hook scope should be project");
    assertEquals(resolved.pythonProvider, "ty", "Project provider should come from disk");
    assertEquals(resolved.pythonScope, "project", "Python scope should be project");
  });
});

test("TreeSitterManager: reports syntax diagnostics without project config", async () => {
  await withTempDir({
    "broken.ts": "const broken = ;\n",
  }, async (dir) => {
    const manager = new TreeSitterManager();
    const diagnostics = manager.getDiagnostics(join(dir, "broken.ts"));

    assert(diagnostics.length > 0, "Expected Tree-sitter diagnostics for invalid TypeScript");
    assert(
      diagnostics.some((diagnostic) => diagnostic.message.toLowerCase().includes("syntax") || diagnostic.message.toLowerCase().includes("missing")),
      `Expected syntax-oriented diagnostic message, got: ${diagnostics.map((diagnostic) => diagnostic.message).join(", ")}`,
    );
  });
});

test("LSPManager: falls back to Tree-sitter diagnostics without LSP root", async () => {
  await withTempDir({
    "broken.ts": "const broken = ;\n",
  }, async (dir) => {
    const manager = new LSPManager(dir);
    try {
      const result = await manager.touchFileAndWait(join(dir, "broken.ts"), 1000);
      assert(result.receivedResponse, "Expected fallback diagnostics to count as a response");
      assert(!result.unsupported, `Expected Tree-sitter fallback instead of unsupported: ${result.error ?? ""}`);
      assert(result.diagnostics.length > 0, "Expected fallback diagnostics for invalid TypeScript");
    } finally {
      await manager.shutdown();
    }
  });
});

test("LSPManager: uses Tree-sitter for document symbols and folding ranges", async () => {
  await withTempDir({
    "main.py": `class Greeter:\n    def greet(self, name: str) -> str:\n        return \"hi \" + name\n`,
  }, async (dir) => {
    const file = join(dir, "main.py");
    const manager = new LSPManager(dir);
    try {
      assert(await manager.supportsOperation(file, "documentSymbol"), "Expected documentSymbol fallback support");
      assert(await manager.supportsOperation(file, "foldingRange"), "Expected foldingRange fallback support");

      const symbols = await manager.getDocumentSymbols(file);
      assert(symbols.some((symbol) => symbol.name === "Greeter"), `Expected class symbol, got: ${symbols.map((symbol) => symbol.name).join(", ")}`);
      assert(symbols.some((symbol) => symbol.name === "greet"), `Expected method symbol, got: ${symbols.map((symbol) => symbol.name).join(", ")}`);

      const ranges = await manager.getFoldingRanges(file);
      assert(ranges.length > 0, "Expected folding ranges from Tree-sitter fallback");
    } finally {
      await manager.shutdown();
    }
  });
});

test("LSPManager: uses Tree-sitter for same-file definitions and references", async () => {
  await withTempDir({
    "main.ts": `function greet(name: string) {\n  return name;\n}\n\nconst first = greet(\"a\");\nconst second = greet(\"b\");\n`,
  }, async (dir) => {
    const file = join(dir, "main.ts");
    const manager = new LSPManager(dir);
    try {
      assert(await manager.supportsOperation(file, "goToDefinition"), "Expected definition fallback support");
      assert(await manager.supportsOperation(file, "findReferences"), "Expected reference fallback support");

      const definitions = await manager.getDefinition(file, 5, 15);
      assert(definitions.length > 0, "Expected same-file definition from Tree-sitter fallback");
      assertEquals(definitions[0]?.range.start.line, 0, "Definition should point to the function declaration");

      const references = await manager.getReferences(file, 1, 10);
      assert(references.length >= 3, `Expected declaration plus two calls, got ${references.length}`);
    } finally {
      await manager.shutdown();
    }
  });
});


test("LSPManager: uses Tree-sitter for document highlights", async () => {
  await withTempDir({
    "main.ts": `function greet(name: string) {
  return name;
}

const first = greet("a");
const second = greet("b");
`,
  }, async (dir) => {
    const file = join(dir, "main.ts");
    const manager = new LSPManager(dir);
    try {
      assert(await manager.supportsOperation(file, "documentHighlight"), "Expected documentHighlight fallback support");
      const highlights = await manager.getDocumentHighlights(file, 5, 15);
      assert(highlights.length >= 3, `Expected declaration plus two highlighted calls, got ${highlights.length}`);
    } finally {
      await manager.shutdown();
    }
  });
});

test("LSPManager: uses Tree-sitter for workspace symbols", async () => {
  await withTempDir({
    "src/main.ts": `function greet(name: string) {
  return name;
}

export const answer = 42;
`,
    "src/helper.py": `class Helper:
    def ping(self):
        return "pong"
`,
  }, async (dir) => {
    const file = join(dir, "src/main.ts");
    const manager = new LSPManager(dir);
    try {
      assert(await manager.supportsOperation(file, "workspaceSymbol"), "Expected workspaceSymbol fallback support");
      assertEquals(await manager.getOperationBackend(file, "workspaceSymbol"), "tree-sitter");

      const allSymbols = await manager.getWorkspaceSymbols(file);
      assert(allSymbols.some((symbol) => symbol.name === "greet"), `Expected workspace symbol for greet, got: ${allSymbols.map((symbol) => symbol.name).join(", ")}`);
      assert(allSymbols.some((symbol) => symbol.name === "Helper"), `Expected workspace symbol for Helper, got: ${allSymbols.map((symbol) => symbol.name).join(", ")}`);

      const filtered = await manager.getWorkspaceSymbols(file, "hel");
      assertEquals(filtered.length, 1, `Expected one filtered workspace symbol, got ${filtered.length}`);
      assertEquals(filtered[0]?.name, "Helper");
    } finally {
      await manager.shutdown();
    }
  });
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
