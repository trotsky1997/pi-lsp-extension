/**
 * Unit tests for index.ts formatting functions
 */

// ============================================================================
// Test utilities
// ============================================================================

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(message || `Expected ${e}, got ${a}`);
}

// ============================================================================
// Import the module to test internal functions
// We need to test via the execute function since formatters are private
// Or we can extract and test the logic directly
// ============================================================================

import { uriToPath, findSymbolPosition, formatDiagnostic, filterDiagnosticsBySeverity } from "../lsp-core.js";
import {
  formatDocumentHighlightResult,
  formatDocumentSymbolResult,
  formatFindReferencesResult,
  formatFoldingRangeResult,
  formatGoToDefinitionResult,
  formatPrepareCallHierarchyResult,
  formatWorkspaceSymbolResult,
} from "../lsp-tool-formatters.js";
import { buildOperationSummary, withBackendLabel } from "../lsp-tool.js";
import { safeParseLspToolInput } from "../lsp-tool-schemas.js";
import { extractApplyPatchPaths, extractBashRedirectionPaths, selectPendingDiagnosticsForConfig } from "../lsp.js";

// ============================================================================
// uriToPath tests
// ============================================================================

test("uriToPath: converts file:// URI to path", () => {
  const result = uriToPath("file:///Users/test/file.ts");
  assertEqual(result, "/Users/test/file.ts");
});

test("uriToPath: handles encoded characters", () => {
  const result = uriToPath("file:///Users/test/my%20file.ts");
  assertEqual(result, "/Users/test/my file.ts");
});

test("uriToPath: passes through non-file URIs", () => {
  const result = uriToPath("/some/path.ts");
  assertEqual(result, "/some/path.ts");
});

test("uriToPath: handles invalid URIs gracefully", () => {
  const result = uriToPath("not-a-valid-uri");
  assertEqual(result, "not-a-valid-uri");
});

// ============================================================================
// findSymbolPosition tests
// ============================================================================

test("findSymbolPosition: finds exact match", () => {
  const symbols = [
    { name: "greet", range: { start: { line: 5, character: 10 }, end: { line: 5, character: 15 } }, selectionRange: { start: { line: 5, character: 10 }, end: { line: 5, character: 15 } }, kind: 12, children: [] },
    { name: "hello", range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } }, selectionRange: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } }, kind: 12, children: [] },
  ];
  const pos = findSymbolPosition(symbols as any, "greet");
  assertEqual(pos, { line: 5, character: 10 });
});

test("findSymbolPosition: finds partial match", () => {
  const symbols = [
    { name: "getUserName", range: { start: { line: 3, character: 0 }, end: { line: 3, character: 11 } }, selectionRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 11 } }, kind: 12, children: [] },
  ];
  const pos = findSymbolPosition(symbols as any, "user");
  assertEqual(pos, { line: 3, character: 0 });
});

test("findSymbolPosition: prefers exact over partial", () => {
  const symbols = [
    { name: "userName", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } }, selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } }, kind: 12, children: [] },
    { name: "user", range: { start: { line: 5, character: 0 }, end: { line: 5, character: 4 } }, selectionRange: { start: { line: 5, character: 0 }, end: { line: 5, character: 4 } }, kind: 12, children: [] },
  ];
  const pos = findSymbolPosition(symbols as any, "user");
  assertEqual(pos, { line: 5, character: 0 });
});

test("findSymbolPosition: searches nested children", () => {
  const symbols = [
    { 
      name: "MyClass", 
      range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } }, 
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } }, 
      kind: 5,
      children: [
        { name: "myMethod", range: { start: { line: 2, character: 2 }, end: { line: 4, character: 2 } }, selectionRange: { start: { line: 2, character: 2 }, end: { line: 2, character: 10 } }, kind: 6, children: [] },
      ]
    },
  ];
  const pos = findSymbolPosition(symbols as any, "myMethod");
  assertEqual(pos, { line: 2, character: 2 });
});

test("findSymbolPosition: returns null for no match", () => {
  const symbols = [
    { name: "foo", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, kind: 12, children: [] },
  ];
  const pos = findSymbolPosition(symbols as any, "bar");
  assertEqual(pos, null);
});

test("findSymbolPosition: case insensitive", () => {
  const symbols = [
    { name: "MyFunction", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, kind: 12, children: [] },
  ];
  const pos = findSymbolPosition(symbols as any, "myfunction");
  assertEqual(pos, { line: 0, character: 0 });
});

// ============================================================================
// formatDiagnostic tests
// ============================================================================

test("formatDiagnostic: formats error", () => {
  const diag = {
    range: { start: { line: 5, character: 10 }, end: { line: 5, character: 15 } },
    message: "Type 'number' is not assignable to type 'string'",
    severity: 1,
  };
  const result = formatDiagnostic(diag as any);
  assertEqual(result, "ERROR [6:11] Type 'number' is not assignable to type 'string'");
});

test("formatDiagnostic: formats warning", () => {
  const diag = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    message: "Unused variable",
    severity: 2,
  };
  const result = formatDiagnostic(diag as any);
  assertEqual(result, "WARN [1:1] Unused variable");
});

test("formatDiagnostic: formats info", () => {
  const diag = {
    range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } },
    message: "Consider using const",
    severity: 3,
  };
  const result = formatDiagnostic(diag as any);
  assertEqual(result, "INFO [3:5] Consider using const");
});

test("formatDiagnostic: formats hint", () => {
  const diag = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    message: "Prefer arrow function",
    severity: 4,
  };
  const result = formatDiagnostic(diag as any);
  assertEqual(result, "HINT [1:1] Prefer arrow function");
});

test("extractApplyPatchPaths: finds add and update targets", () => {
  const result = extractApplyPatchPaths(`*** Begin Patch
*** Add File: src/new.ts
+const value = 1;
*** Update File: src/existing.ts
@@
-const oldValue = 1;
+const oldValue = 2;
*** End Patch`);

  assertEqual(result, ["src/new.ts", "src/existing.ts"]);
});

test("extractApplyPatchPaths: tracks moved path", () => {
  const result = extractApplyPatchPaths(`*** Begin Patch
*** Update File: src/old.ts
*** Move to: src/new.ts
@@
-export const value = 1;
+export const value = 2;
*** End Patch`);

  assertEqual(result, ["src/new.ts"]);
});

test("selectPendingDiagnosticsForConfig: returns recent files under config root", () => {
  const pending = new Map([
    ["/workspace/app/src/first.ts", { includeWarnings: false, lastTouchedAt: 950 }],
    ["/workspace/app/src/second.ts", { includeWarnings: true, lastTouchedAt: 980 }],
    ["/workspace/other/outside.ts", { includeWarnings: true, lastTouchedAt: 990 }],
  ]);

  const result = selectPendingDiagnosticsForConfig("/workspace/app/tsconfig.json", pending as any, 1000, 100);

  assertEqual(result, [
    { filePath: "/workspace/app/src/second.ts", includeWarnings: true },
    { filePath: "/workspace/app/src/first.ts", includeWarnings: false },
  ]);
});

test("selectPendingDiagnosticsForConfig: drops stale files", () => {
  const pending = new Map([
    ["/workspace/app/src/stale.ts", { includeWarnings: true, lastTouchedAt: 100 }],
    ["/workspace/app/src/fresh.ts", { includeWarnings: false, lastTouchedAt: 980 }],
  ]);

  const result = selectPendingDiagnosticsForConfig("/workspace/app/package.json", pending as any, 1000, 100);

  assertEqual(result, [
    { filePath: "/workspace/app/src/fresh.ts", includeWarnings: false },
  ]);
});

test("extractBashRedirectionPaths: finds cat overwrite and append targets", () => {
  const result = extractBashRedirectionPaths(`mkdir -p src && cat > src/index.ts <<'EOF'
export const broken = ;
EOF
cat >> src/index.ts <<'EOF'
console.log(broken);
EOF`);

  assertEqual(result, ["src/index.ts"]);
});

test("extractBashRedirectionPaths: finds append targets from echo and printf", () => {
  const result = extractBashRedirectionPaths(`echo "export const broken = ;" >> src/index.ts
printf 'console.log(broken);\n' >> "src/index.ts"`);

  assertEqual(result, ["src/index.ts"]);
});

test("extractBashRedirectionPaths: ignores stderr redirects", () => {
  const result = extractBashRedirectionPaths(`cat src/index.ts 2> errors.log
echo ok 1> stdout.log`);

  assertEqual(result, []);
});

// ============================================================================
// filterDiagnosticsBySeverity tests
// ============================================================================

test("filterDiagnosticsBySeverity: all returns everything", () => {
  const diags = [
    { severity: 1, message: "error", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { severity: 2, message: "warning", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { severity: 3, message: "info", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { severity: 4, message: "hint", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
  ];
  const result = filterDiagnosticsBySeverity(diags as any, "all");
  assertEqual(result.length, 4);
});

test("filterDiagnosticsBySeverity: error returns only errors", () => {
  const diags = [
    { severity: 1, message: "error", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { severity: 2, message: "warning", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
  ];
  const result = filterDiagnosticsBySeverity(diags as any, "error");
  assertEqual(result.length, 1);
  assertEqual(result[0].message, "error");
});

test("filterDiagnosticsBySeverity: warning returns errors and warnings", () => {
  const diags = [
    { severity: 1, message: "error", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { severity: 2, message: "warning", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { severity: 3, message: "info", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
  ];
  const result = filterDiagnosticsBySeverity(diags as any, "warning");
  assertEqual(result.length, 2);
});

test("filterDiagnosticsBySeverity: info returns errors, warnings, and info", () => {
  const diags = [
    { severity: 1, message: "error", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { severity: 2, message: "warning", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { severity: 3, message: "info", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { severity: 4, message: "hint", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
  ];
  const result = filterDiagnosticsBySeverity(diags as any, "info");
  assertEqual(result.length, 3);
});

// ============================================================================
// lsp-tool formatter tests
// ============================================================================

test("formatGoToDefinitionResult: formats a single location", () => {
  const result = formatGoToDefinitionResult({
    uri: "file:///workspace/src/app.ts",
    range: {
      start: { line: 4, character: 2 },
      end: { line: 4, character: 8 },
    },
  } as any, "/workspace");

  assertEqual(result, "Defined in src/app.ts:5:3");
});

test("formatFindReferencesResult: groups references by file", () => {
  const result = formatFindReferencesResult([
    {
      uri: "file:///workspace/src/app.ts",
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
    },
    {
      uri: "file:///workspace/src/app.ts",
      range: { start: { line: 4, character: 2 }, end: { line: 4, character: 6 } },
    },
    {
      uri: "file:///workspace/src/util.ts",
      range: { start: { line: 2, character: 1 }, end: { line: 2, character: 5 } },
    },
  ] as any, "/workspace");

  assertEqual(
    result,
    [
      "Found 3 references across 2 files:",
      "",
      "src/app.ts:",
      "  Line 2:1",
      "  Line 5:3",
      "",
      "src/util.ts:",
      "  Line 3:2",
    ].join("\n"),
  );
});

test("formatDocumentSymbolResult: formats hierarchical symbols", () => {
  const result = formatDocumentSymbolResult([
    {
      name: "MyClass",
      kind: 5,
      detail: "class",
      range: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
      children: [
        {
          name: "run",
          kind: 6,
          range: { start: { line: 2, character: 2 }, end: { line: 3, character: 2 } },
          selectionRange: { start: { line: 2, character: 2 }, end: { line: 2, character: 5 } },
          children: [],
        },
      ],
    },
  ] as any, "/workspace");

  assertEqual(
    result,
    [
      "Document symbols:",
      "MyClass (Class) class - Line 1",
      "  run (Method) - Line 3",
    ].join("\n"),
  );
});

test("formatDocumentHighlightResult: formats highlight ranges", () => {
  const result = formatDocumentHighlightResult([
    {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
      kind: 2,
    },
    {
      range: { start: { line: 4, character: 2 }, end: { line: 4, character: 7 } },
      kind: 3,
    },
  ] as any);

  assertEqual(
    result,
    [
      "Found 2 document highlights:",
      "  2:1 (read)",
      "  5:3 (write)",
    ].join("\n"),
  );
});

test("formatWorkspaceSymbolResult: groups workspace symbols by file", () => {
  const result = formatWorkspaceSymbolResult([
    {
      name: "run",
      kind: 12,
      location: {
        uri: "file:///workspace/src/app.ts",
        range: { start: { line: 9, character: 0 }, end: { line: 9, character: 3 } },
      },
      containerName: "App",
    },
  ] as any, "/workspace");

  assertEqual(
    result,
    [
      "Found 1 symbol in workspace:",
      "",
      "src/app.ts:",
      "  run (Function) - Line 10 in App",
    ].join("\n"),
  );
});

test("buildOperationSummary: prefixes Tree-sitter fallback summaries", () => {
  const result = buildOperationSummary({
    operation: "documentSymbol",
    backend: "tree-sitter",
    resultCount: 2,
    fileCount: 1,
  });

  assertEqual(result, "Tree-sitter fallback: Found 2 symbols");
});

test("withBackendLabel: prefixes Tree-sitter text output", () => {
  const result = withBackendLabel("No diagnostics.", "tree-sitter");
  assertEqual(result, "Fallback provider: tree-sitter\nNo diagnostics.");
});

test("formatPrepareCallHierarchyResult: formats a single call item", () => {
  const result = formatPrepareCallHierarchyResult([
    {
      name: "run",
      kind: 12,
      uri: "file:///workspace/src/app.ts",
      range: { start: { line: 9, character: 0 }, end: { line: 12, character: 0 } },
      selectionRange: { start: { line: 9, character: 0 }, end: { line: 9, character: 3 } },
      detail: "function run()",
    },
  ] as any, "/workspace");

  assertEqual(result, "Call hierarchy item: run (Function) - src/app.ts:10 [function run()]");
});

test("formatFoldingRangeResult: formats ranges", () => {
  const result = formatFoldingRangeResult([
    { startLine: 0, endLine: 4, kind: "region" },
    { startLine: 7, endLine: 10 },
  ] as any);

  assertEqual(
    result,
    [
      "Found 2 folding ranges:",
      "  1-5 (region)",
      "  8-11",
    ].join("\n"),
  );
});

// ============================================================================
// lsp-tool zod schema tests
// ============================================================================

test("safeParseLspToolInput: accepts Claude-style core operation", () => {
  const result = safeParseLspToolInput({
    operation: "goToDefinition",
    filePath: "src/index.ts",
    line: 12,
    character: 7,
  });

  assertEqual(result.success, true);
});

test("safeParseLspToolInput: accepts typeDefinition and prepareRename", () => {
  const typeDefinition = safeParseLspToolInput({
    operation: "typeDefinition",
    filePath: "src/index.ts",
    line: 8,
    character: 12,
  });
  const prepareRename = safeParseLspToolInput({
    operation: "prepareRename",
    filePath: "src/index.ts",
    line: 3,
    character: 5,
  });

  assertEqual(typeDefinition.success, true);
  assertEqual(prepareRename.success, true);
});

test("safeParseLspToolInput: accepts documentHighlight and foldingRange", () => {
  const documentHighlight = safeParseLspToolInput({
    operation: "documentHighlight",
    filePath: "src/index.ts",
    line: 8,
    character: 12,
  });
  const foldingRange = safeParseLspToolInput({
    operation: "foldingRange",
    filePath: "src/index.ts",
  });

  assertEqual(documentHighlight.success, true);
  assertEqual(foldingRange.success, true);
});

test("safeParseLspToolInput: rejects workspaceDiagnostics without filePaths", () => {
  const result = safeParseLspToolInput({
    operation: "workspaceDiagnostics",
    severity: "error",
  });

  assertEqual(result.success, false);
});

test("safeParseLspToolInput: rejects rename without newName", () => {
  const result = safeParseLspToolInput({
    operation: "rename",
    filePath: "src/index.ts",
    line: 3,
    character: 5,
  });

  assertEqual(result.success, false);
});

test("safeParseLspToolInput: rejects partial codeAction ranges", () => {
  const result = safeParseLspToolInput({
    operation: "codeAction",
    filePath: "src/index.ts",
    line: 10,
    character: 2,
    endLine: 11,
  });

  assertEqual(result.success, false);
});

test("safeParseLspToolInput: rejects unknown extra keys", () => {
  const result = safeParseLspToolInput({
    operation: "diagnostics",
    filePath: "src/index.ts",
    severity: "warning",
    query: "legacy",
  });

  assertEqual(result.success, false);
});

// ============================================================================
// Run tests
// ============================================================================

async function runTests(): Promise<void> {
  console.log("Running index.ts unit tests...\n");

  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ${name}... ✓`);
      passed++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  ${name}... ✗`);
      console.log(`    Error: ${msg}\n`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
