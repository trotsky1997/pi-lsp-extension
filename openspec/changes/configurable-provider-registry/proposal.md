## Why

`openlsp-cli` currently defines most LSP servers, formatters, and analyzers as hardcoded TypeScript arrays with provider-specific command construction scattered across core modules. This makes the provider surface hard to extend, hard to override, and expensive to maintain as the supported language list grows.

## What Changes

- Introduce a unified provider manifest model for LSP, formatter, analyzer, and future provider kinds.
- Add a provider registry that loads built-in manifests and workspace/user-configured manifests through the same validation and selection path.
- Support simple command-based providers through configuration without requiring TypeScript changes.
- Keep complex providers as code-backed providers when they need custom discovery, install, lifecycle, or output parsing behavior.
- Migrate an initial representative set of existing hardcoded providers to manifest-backed registration while preserving current command behavior.
- Expose registry-backed capabilities so `openlsp-cli capabilities`, hook execution, local commands, and server mode all report the same provider source and selection metadata.
- Preserve compatibility with the current `adapters` config during the migration.

## Capabilities

### New Capabilities

- `openlsp-provider-registry`: Covers unified provider manifests, provider loading, validation, selection, config overrides, compatibility with existing adapters, and the migration path away from hardcoded provider arrays.

### Modified Capabilities

No existing OpenSpec capabilities are modified. This repository has no current baseline specs under `openspec/specs/`.

## Impact

- Affects `openlsp-cli/src/core/lsp-core.ts`, `formatter-core.ts`, `analyzer-core.ts`, `adapter-registry.ts`, config schemas, capability output, tests, and docs.
- Adds built-in provider manifest files or equivalent manifest modules under `openlsp-cli`.
- Adds a registry API used by LSP, formatter, analyzer, hooks, and capability inspection.
- Does not remove every legacy hardcoded provider in the first implementation; complex providers can remain code-backed behind the unified registry.
- Does not change existing CLI command names, JSON envelopes, or server endpoints.
