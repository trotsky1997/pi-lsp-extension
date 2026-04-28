## Context

`openlsp-cli/` already exists as a first extraction, but several source files still import from the parent Pi extension tree through paths such as `../../lsp-core.ts`. The directory also sits inside the extension repository, so a passing CLI test can still depend on files that would disappear after extraction.

The requested direction is to treat `openlsp-cli` as a new project. The old Pi extension can remain as historical code, but it must not define the new project boundary or the first implementation pass.

## Goals / Non-Goals

Goals:

- Make `openlsp-cli` self-contained at the filesystem, package, and TypeScript import levels.
- Preserve the useful command surface from the extraction: `lsp`, `format`, `analyze`, `config`, `capabilities`, `serve`, and `session-close`.
- Keep Bun as the runtime and build target for the CLI.
- Keep language service behavior backed by project-local core modules, copied assets, and tests.
- Produce a project that can later be moved to its own repository with minimal cleanup.

Non-Goals:

- Rebuild or repair the legacy Pi extension.
- Maintain a Pi adapter inside the new CLI project.
- Publish the package to npm in this change.
- Redesign the full LSP, formatter, analyzer, or tree-sitter implementation.

## Decisions

1. Use a standalone project boundary.

   The target implementation will place all CLI source, core modules, tree-sitter assets, tests, package metadata, and docs under the new `openlsp-cli` project root. Continuing to rely on parent imports would keep the project coupled to the old extension repository and would make extraction hard to verify.

2. Copy the needed language-core modules first, then adjust imports.

   The CLI currently depends on `lsp-core.ts`, `lsp-settings.ts`, `formatter-core.ts`, `analyzer-core.ts`, `devdocs-core.ts`, `tree-sitter-wasm-core.ts`, and result formatters. Copying these into a project-local core area keeps behavior stable while removing the parent dependency. A larger rewrite into new abstractions can happen after the project boundary is clean.

3. Drop Pi compatibility from the new CLI surface.

   The standalone CLI will use `openlsp.config.json`, explicit command flags, and JSON envelopes as its integration points. Code whose only purpose is translating `.pi/settings.json` or bridging a Pi tool call belongs outside this project. If a Pi adapter is needed later, it should be a separate adapter package or integration layer.

4. Keep the JSON protocol stable during extraction.

   Existing request and response envelopes are useful for agents and for remote server mode. The extraction should preserve schema validation and command output shape while changing the module layout underneath.

5. Verify from the standalone directory.

   Validation must run with the working directory set to `openlsp-cli`, using project-local scripts. Checks from the old repository root are not enough because they can hide parent import leaks.

## Risks / Trade-offs

- Risk: Copying core modules can duplicate code temporarily. Mitigation: keep the copied modules mechanically close to the current behavior and defer larger cleanup until after extraction.
- Risk: Tree-sitter WASM and query paths can break after files move. Mitigation: place assets under the new project root and add tests or smoke commands that exercise fallback symbol operations.
- Risk: External language server binaries may not be installed in the developer environment. Mitigation: keep unit tests focused on config, command routing, and no-parent-import checks; document binary requirements for integration use.
- Risk: Removing Pi compatibility may break callers that were using the old extension path. Mitigation: this change explicitly scopes those callers out; the old extension tree is left untouched unless a later adapter change is requested.

## Migration Plan

1. Create or normalize the standalone `openlsp-cli` project root.
2. Move or copy required core modules and assets into that root.
3. Rewrite CLI imports so no source file reaches outside the project.
4. Remove or isolate Pi-specific compatibility code from the CLI package.
5. Update package metadata, scripts, docs, and ignore rules for standalone development.
6. Run validation from the `openlsp-cli` directory: dependency install if needed, typecheck, unit tests, CLI smoke command, and build.

Rollback is file-level: keep the existing Pi extension repository untouched, and revert only the new project extraction changes if validation fails.

## Open Questions

- The final repository location can be decided during implementation. A sibling directory such as `/mnt/c/Users/trots/openlsp-cli` is the cleanest target if the intent is a separate project outside this repository.
- The package can stay private for now or become publish-ready later. The implementation should still define a usable `bin` entry and build output.
