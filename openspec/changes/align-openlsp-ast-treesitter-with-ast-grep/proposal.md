## Why

`openlsp-cli` currently uses tree-sitter primarily as a fallback implementation for diagnostics, symbols, references, and folding ranges. That makes the AST layer useful but still too tied to LSP fallback behavior, while ast-grep demonstrates a stronger model: language registration, document ownership, node facades, pattern parsing, structural matching, incremental parsing, and included-range parsing as reusable primitives.

Aligning the AST/tree-sitter layer with that model gives OpenLSP a stable internal foundation for hooks, agents, analyzers, future code search, and provider-backed language intelligence without scattering parser-specific behavior across command code.

## What Changes

- Introduce a first-class AST/tree-sitter core for `openlsp-cli` with language registry, parser cache, document objects, node facades, pattern ASTs, and structural matching.
- Add ast-grep-style pattern parsing where source-like patterns are parsed with the same language grammar and converted into OpenLSP pattern nodes.
- Add metavariable preprocessing and capture extraction for pattern matching.
- Add incremental document edit support using tree-sitter old-tree reparsing.
- Add included-range parsing as the base primitive for injection-style parsing of embedded language regions.
- Route tree-sitter fallback operations through the new AST service instead of exposing a legacy tree-sitter manager API.
- **BREAKING**: remove the old `TreeSitterManager` and `getOrCreateTreeSitterManager` API from `openlsp-cli` internals and tests.

## Capabilities

### New Capabilities

- `openlsp-ast-treesitter-core`: Covers the reusable AST/tree-sitter language registry, document model, node facade, pattern AST parsing, structural matching, incremental parsing, included-range parsing, and LSP fallback integration.

### Modified Capabilities

- None.

## Impact

- Affects `openlsp-cli/src/core/tree-sitter-wasm-core.ts`, `openlsp-cli/src/core/tree-sitter-core.ts`, and LSP fallback call sites in `openlsp-cli/src/core/lsp-core.ts`.
- Affects tree-sitter focused tests under `openlsp-cli/tests/`.
- Keeps existing `@vscode/tree-sitter-wasm` dependency and project-local query/WASM assets.
- Enables future hook, analyzer, and provider features to consume AST primitives directly instead of depending on LSP fallback methods.
