## Why

`openlsp-cli` currently runs inside the repository, but its source still imports core modules from the Pi extension parent tree and `tsc --noEmit` does not pass. This leaves the CLI in a usable prototype state, but not in a standalone state that can be typechecked, built, or extracted with confidence.

## What Changes

- Copy or migrate the language-core dependencies that `openlsp-cli` still imports from the parent directory into the `openlsp-cli` project.
- Rewrite CLI source imports so production code no longer references files outside `openlsp-cli`.
- Fix TypeScript strict-mode errors and make `tsc --noEmit` pass from the `openlsp-cli` project root.
- Add a `typecheck` package script and align validation docs with the actual script surface.
- Add or update validation coverage that fails when `openlsp-cli/src` imports parent-directory modules.
- Keep Pi compatibility outside the standalone CLI boundary, with any bridge code remaining in the parent repository or a clearly isolated adapter.

## Capabilities

### New Capabilities

- `openlsp-cli-standalone-boundary`: Covers the standalone source boundary, project-local core modules, no-parent-import validation, typecheck script, and validation behavior required before `openlsp-cli` can be treated as an independent package.

### Modified Capabilities

No existing OpenSpec capabilities are modified. This repository has no current baseline specs under `openspec/specs/`.

## Impact

- Affects `openlsp-cli/src`, `openlsp-cli/tests`, `openlsp-cli/package.json`, `openlsp-cli/tsconfig.json`, lockfile state, and standalone documentation.
- May copy existing parent modules such as LSP core, settings, formatter core, analyzer core, DevDocs, tree-sitter utilities, and output formatters into `openlsp-cli`.
- May update the parent Pi adapter only if needed to keep compatibility with the new standalone entrypoint.
- Does not change the user-facing CLI command contract except to make validation and packaging more reliable.
