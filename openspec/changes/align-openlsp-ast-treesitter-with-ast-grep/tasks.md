## 1. AST Language Registry

- [x] 1.1 Define `AstLanguage` metadata with id, extensions, tree-sitter language, query paths, metavariable configuration, `kindToId`, and `fieldToId`.
- [x] 1.2 Implement `AstLanguageRegistry` for language listing, path-based language lookup, parser caching, query caching, and operation support checks.
- [x] 1.3 Preserve existing bundled tree-sitter WASM and query asset resolution through the new registry.

## 2. Document and Node Model

- [x] 2.1 Implement `AstDocument` as the owner of source text, language metadata, parser, tree, root node, and optional absolute path.
- [x] 2.2 Implement `AstNode` as the stable facade over tree-sitter nodes with metadata, children, field lookup, traversal, and ancestor lookup.
- [x] 2.3 Add file parsing and source parsing APIs that return AST document or parsed file data for fallback operations.

## 3. Pattern Parsing and Matching

- [x] 3.1 Add language-aware pattern preprocessing for uppercase metavariable tokens and language-specific expando characters.
- [x] 3.2 Parse source-like patterns with the selected language parser and convert the parsed tree into `AstPatternNode`.
- [x] 3.3 Implement structural pattern matching over `AstNode` trees with capture maps for metavariables.
- [x] 3.4 Add `AstService.parsePattern` and `AstService.findPattern` convenience APIs for callers.

## 4. Incremental and Included-Range Parsing

- [x] 4.1 Implement `AstDocument.edit` using byte offsets, tree-sitter edit metadata, and old-tree reparsing.
- [x] 4.2 Implement included-range parsing that converts byte ranges to tree-sitter ranges while preserving document-relative positions.
- [x] 4.3 Expose included-range parsing through the registry and `AstService`.

## 5. LSP Fallback Migration

- [x] 5.1 Replace `getOrCreateTreeSitterManager` usage in `openlsp-cli/src/core/lsp-core.ts` with `getOrCreateAstService`.
- [x] 5.2 Move existing diagnostics, symbols, references, hover, highlights, workspace symbols, and folding range fallback methods onto `AstService`.
- [x] 5.3 Remove the old `TreeSitterManager` and `getOrCreateTreeSitterManager` API names from `openlsp-cli` source and tests.

## 6. Tests and Validation

- [x] 6.1 Update tree-sitter tests to use `AstService` and assert existing fallback behavior still works.
- [x] 6.2 Add tests for language registry metadata, pattern AST parsing, pattern captures, incremental edits, and included-range parsing.
- [x] 6.3 Run `bun run typecheck` from `openlsp-cli`.
- [x] 6.4 Run `bun test tests/tree-sitter.test.ts` from `openlsp-cli`.
- [x] 6.5 Run full `bun test` from `openlsp-cli`.
- [x] 6.6 Run `bun run build` from `openlsp-cli`.
