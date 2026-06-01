## Context

`openlsp-cli` already has a Bun package, CLI entrypoint, tests, server mode, and build command. Runtime smoke checks pass, but the project is not actually standalone because several files under `openlsp-cli/src` import implementation modules from the parent Pi extension directory. Running `tsc --noEmit` from `openlsp-cli` also fails under strict mode and checks parent files through those imports.

The implementation should preserve the current CLI command contract while making the package boundary real. The goal is a project that can be validated from `openlsp-cli/` without depending on TypeScript source outside that directory.

## Goals / Non-Goals

**Goals:**

- Make every production import from `openlsp-cli/src` resolve inside `openlsp-cli` or to declared package dependencies.
- Bring required language-core modules and runtime assets into the CLI project using the smallest migration that preserves behavior.
- Make `bun run typecheck`, `bun test`, a CLI smoke command, and `bun run build` pass from `openlsp-cli/`.
- Add validation coverage that prevents parent-directory imports from returning unnoticed.
- Keep Pi integration functional through an adapter outside the standalone CLI package.

**Non-Goals:**

- Rewriting the LSP manager, formatter orchestration, analyzer orchestration, or tree-sitter integration into a new architecture.
- Changing CLI JSON envelopes, command names, argument names, or server endpoints.
- Publishing `openlsp-cli` as a separate repository or npm package in this change.
- Removing the existing parent repository implementation before the CLI boundary is proven.

## Decisions

1. Copy required core modules first, then refactor incrementally.

   The current parent modules are already the behavior source for LSP, formatting, analysis, settings, DevDocs, tree-sitter, and text formatting. Copying them into a project-local `src/core/` area minimizes behavioral risk and creates a clear boundary. A deeper refactor can happen after validation proves the extracted copy works.

   Alternative considered: rewrite the core services around the newer CLI OOP services immediately. That would reduce copied code long term, but it combines extraction with a large behavior change and makes regressions harder to isolate.

2. Treat `openlsp-cli/src` parent imports as invalid.

   Production code must not import `../../*.ts` or otherwise reach outside the package root. Tests may import project-local source through `../src/...`, but no test should rely on parent source to prove CLI behavior.

   Alternative considered: allow parent imports temporarily and document them. That keeps the current implementation moving but fails the stated standalone goal and keeps `tsc` coupled to the parent project.

3. Keep the Pi bridge outside the CLI package.

   Parent-level Pi compatibility can continue to translate `.pi/settings.json` and delegate to the CLI, but `openlsp-cli` native config resolution must not read `.pi/settings.json`. This preserves migration compatibility without making Pi settings part of the standalone CLI contract.

   Alternative considered: keep `pi-compat.ts` inside `openlsp-cli/src`. That makes compatibility easy to call, but it blurs the boundary and risks reintroducing Pi-specific config assumptions.

4. Make typechecking a first-class package script.

   `package.json` should expose `typecheck`, and documentation should use that script rather than ad hoc `bunx tsc --noEmit` commands. This makes validation repeatable and keeps OpenSpec tasks aligned with the actual project interface.

   Alternative considered: rely on `bun test` and `bun build` only. Those checks have already passed despite unresolved standalone and strict-type issues, so they are insufficient.

## Risks / Trade-offs

- Duplicated parent and CLI core code can drift -> Keep this change focused on establishing the boundary, then plan follow-up cleanup or deletion once the CLI path is authoritative.
- Copied modules may reference assets or helper files outside `openlsp-cli` -> Add import and asset validation so missing dependencies fail during tests or typecheck.
- Strict-mode fixes may require local type annotations in copied legacy code -> Prefer narrow annotations and helper types over broad `any` relaxation.
- Build output can become platform-specific on Windows -> Validate the Bun compile command used by the package script and keep generated artifacts out of source control unless intentionally tracked.

## Migration Plan

1. Copy the required parent modules and assets into `openlsp-cli/src/core/` or another project-local location.
2. Rewrite `openlsp-cli/src` imports to project-local paths and remove Pi-only code from the standalone source tree.
3. Add `typecheck` and any no-parent-import validation scripts or tests.
4. Fix strict TypeScript errors until `bun run typecheck` passes from `openlsp-cli/`.
5. Run the full standalone validation sequence: `bun run typecheck`, `bun test`, CLI capabilities smoke, and `bun run build`.
6. If a regression appears, rollback by reverting the CLI import rewrites while keeping this OpenSpec change for a smaller follow-up.

## Open Questions

- Should copied core modules live under `src/core/` or preserve their current filenames at `src/` for the first migration?
- Should the no-parent-import check be a Bun test, a package script, or both?
- Should the existing `openlsp-cli/src/pi-compat.ts` be removed entirely or moved to a parent-level adapter module during implementation?
