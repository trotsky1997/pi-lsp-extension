## Why

The current OpenLSP work is still physically and semantically tied to the Pi extension repository. That makes the CLI hard to develop, test, package, or reason about as its own tool.

This change extracts `openlsp-cli` into a standalone project with its own source tree, package metadata, tests, and documentation. The old Pi extension integration is out of scope for this change.

## What Changes

- Create a new `openlsp-cli` project outside the Pi extension package boundary.
- Move or copy the language-core code needed by the CLI into the new project so CLI source files do not import from the Pi extension parent tree.
- Keep the CLI focused on local and server-mode language intelligence commands: LSP operations, formatting, analysis, config inspection, capabilities, and session lifecycle.
- Replace Pi compatibility assumptions with project-native config, runtime, and documentation.
- Add project-level validation so `openlsp-cli` can be installed, tested, built, and run without the Pi extension repository.

## Capabilities

### New Capabilities

- `openlsp-standalone-project`: Covers the standalone project layout, package metadata, dependency boundary, scripts, documentation, and repository hygiene for `openlsp-cli`.
- `openlsp-cli-runtime`: Covers the CLI command contract, JSON envelopes, config loading, local execution, server mode, and session behavior.
- `openlsp-language-core`: Covers the project-local language services that power LSP, formatter, analyzer, and tree-sitter operations.

### Modified Capabilities

No existing OpenSpec capabilities are modified. This repository has no current baseline specs under `openspec/specs/`.

## Impact

- Affects `openlsp-cli/` source, tests, package metadata, lockfile, docs, and copied language-core assets.
- Removes parent-directory imports from the CLI project.
- Does not require changes to the legacy Pi extension API, package metadata, or adapter bridge.
- Adds a new project boundary suitable for later extraction into its own repository.
