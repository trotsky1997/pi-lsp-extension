## 1. Inventory and Boundary Plan

- [x] 1.1 List every parent-directory import used by `openlsp-cli/src` and map each one to a project-local destination.
- [x] 1.2 Identify runtime assets required by copied modules, including tree-sitter queries, wasm files, config helpers, and formatter/analyzer support files.
- [x] 1.3 Decide the local module layout for the first migration, such as `src/core/`, and document any intentionally deferred cleanup.

## 2. Migrate Core Dependencies

- [x] 2.1 Copy or move required LSP, settings, formatter, analyzer, DevDocs, tree-sitter, and output-formatting modules into `openlsp-cli`.
- [x] 2.2 Copy or move required runtime assets into `openlsp-cli` and update path resolution to use package-local locations.
- [x] 2.3 Rewrite `openlsp-cli/src` imports so production code resolves only inside `openlsp-cli` or declared package dependencies.
- [x] 2.4 Remove or relocate Pi-only compatibility code from the standalone CLI source tree while preserving parent adapter delegation.

## 3. Typecheck and Validation Coverage

- [x] 3.1 Add a `typecheck` script to `openlsp-cli/package.json` and align README validation commands with it.
- [x] 3.2 Fix strict TypeScript errors in migrated CLI-local code without weakening project-wide strictness.
- [x] 3.3 Add a no-parent-import validation test or script that checks `openlsp-cli/src` and reports the offending file and import.
- [x] 3.4 Add or update tests proving native config resolution ignores `.pi/settings.json`.

## 4. Standalone Verification

- [x] 4.1 Run `bun run typecheck` from `openlsp-cli` and confirm it does not typecheck parent source through CLI imports.
- [x] 4.2 Run `bun test` from `openlsp-cli`.
- [x] 4.3 Run a CLI capabilities smoke command from `openlsp-cli`.
- [x] 4.4 Run the package build script from `openlsp-cli` and confirm the executable output is produced.
- [x] 4.5 Re-run the no-parent-import validation and record the final validation results in the implementation summary.
