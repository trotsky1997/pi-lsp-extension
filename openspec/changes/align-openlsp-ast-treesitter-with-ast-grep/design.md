## Context

`openlsp-cli` already carries project-local tree-sitter WASM assets and query files, and uses them for fallback behavior when a full LSP server is unavailable or insufficient. The current fallback surface is command-oriented: diagnostics, symbols, references, hover, highlights, and folding ranges are implemented directly around tree-sitter parsing and query execution.

The ast-grep architecture provides a better target for OpenLSP's next AST layer. It separates language selection, parser ownership, document/tree ownership, node facade behavior, pattern parsing, structural matching, incremental edits, and included-range parsing. OpenLSP needs the same separation so hooks, analyzers, agents, and future provider kinds can consume AST primitives directly instead of depending on LSP fallback operations.

The change is intentionally focused inside `openlsp-cli`. Parent repository modules and old Pi adapter behavior are not part of this migration.

## Goals / Non-Goals

**Goals:**

- Make AST/tree-sitter a first-class reusable core inside `openlsp-cli`.
- Introduce language registry and language metadata that are usable outside LSP fallback logic.
- Wrap tree-sitter documents and nodes in OpenLSP-owned facades with stable method names and lifecycle.
- Parse source-like patterns through the target language grammar and convert them into an OpenLSP pattern AST.
- Match pattern ASTs against document ASTs and return capture maps for metavariables.
- Support incremental document edits through tree-sitter old-tree reparsing.
- Support included-range parsing as the primitive required for future injection handling.
- Keep existing tree-sitter fallback behavior working through the new AST service.

**Non-Goals:**

- Reimplementing the full ast-grep rule engine, constraints, relational rules, fixers, or rewrite engine.
- Adding new tree-sitter grammar dependencies beyond the currently bundled WASM grammars.
- Building full embedded-language injection extractors for every language in this change.
- Preserving the old `TreeSitterManager` API as a compatibility alias.
- Changing the external CLI command contract for existing LSP operations.

## Decisions

1. Use an OpenLSP AST facade over raw tree-sitter objects.

   `AstLanguage`, `AstLanguageRegistry`, `AstDocument`, `AstNode`, and `AstService` form the public internal boundary. Raw tree-sitter parser, tree, node, and query objects remain implementation details except where low-level tests need to inspect behavior.

   Alternative considered: keep adding methods to the existing tree-sitter manager. That would preserve short-term convenience but keep parser lifecycle, query cache, language selection, and LSP fallback behavior coupled in one large class.

2. Make the new API intentionally breaking inside `openlsp-cli`.

   The old `TreeSitterManager` and `getOrCreateTreeSitterManager` names are removed from `openlsp-cli` source and tests. LSP fallback routes through `AstService` instead.

   Alternative considered: export aliases for the old names. The user explicitly requested no backward compatibility, and aliases would keep new code depending on the old mental model.

3. Parse patterns with the same language grammar used for source files.

   Pattern parsing follows ast-grep's key model: preprocess metavariables, parse the pattern as source, convert the resulting syntax tree into a pattern tree, and match structurally. This keeps patterns language-aware without introducing a separate query language.

   Alternative considered: use tree-sitter query syntax for all pattern matching. Queries are useful for tags/locals, but they do not provide the same source-like ergonomics or capture semantics expected from ast-grep-style patterns.

4. Keep matcher scope deliberately small.

   The matcher supports structural node matching, terminal checks, child matching, and metavariable capture maps. Advanced ast-grep semantics such as relational constraints, ellipsis, strictness modes, and rewrite fixers stay out of scope until they have product requirements.

   Alternative considered: clone a broader ast-grep rule model immediately. That would add complexity before OpenLSP has a concrete command or hook workflow that needs it.

5. Treat included-range parsing as the injection base layer.

   Instead of hardcoding embedded-language extraction rules now, the AST layer exposes parsing for explicit byte ranges. Future language-specific injection providers can build on that primitive without changing document or parser ownership.

   Alternative considered: implement HTML/Markdown/JS/CSS injection extraction immediately. That is useful but broader than aligning the AST core and would need separate language-specific requirements.

## Risks / Trade-offs

- [Risk] The initial structural matcher is smaller than ast-grep's full matcher and may not support every expected pattern. -> Mitigation: document the supported surface, test source-like patterns and captures, and add advanced constructs only when a command or provider needs them.
- [Risk] Byte-offset edits and included ranges can be wrong for non-ASCII text. -> Mitigation: compute tree-sitter positions from UTF-8 byte offsets and add tests around incremental edit paths.
- [Risk] Parser/cache lifecycle bugs can affect all fallback operations. -> Mitigation: route existing fallback tests through `AstService` and run the full `openlsp-cli` test suite.
- [Risk] Removing old API names can break internal tests or imports. -> Mitigation: search `openlsp-cli/src` and `openlsp-cli/tests` for old identifiers and update call sites in the same change.

## Migration Plan

1. Introduce AST language, document, node, pattern, and service abstractions in `openlsp-cli/src/core/tree-sitter-wasm-core.ts`.
2. Move parser and query cache ownership into `AstLanguageRegistry`.
3. Add source-like pattern parsing, metavariable preprocessing, pattern AST conversion, and structural matching.
4. Add incremental `AstDocument.edit` and included-range parsing.
5. Replace `getOrCreateTreeSitterManager` call sites in `openlsp-cli/src/core/lsp-core.ts` with `getOrCreateAstService`.
6. Update tree-sitter tests to assert the new API and existing fallback behavior.
7. Validate with `bun run typecheck`, targeted tree-sitter tests, full `bun test`, and `bun run build` from `openlsp-cli`.

Rollback is simple because this is an internal API migration: revert the AST service change and restore the previous tree-sitter manager call sites.

## Open Questions

- Which advanced ast-grep pattern features should OpenLSP support first: ellipsis/multi-capture, relational constraints, fixers, or rule composition?
- Should embedded-language injection extractors become provider manifests, language registry metadata, or standalone AST plugins?
- Should the AST pattern API become a user-facing CLI command, or remain internal for hooks and analyzers until there is a concrete workflow?
