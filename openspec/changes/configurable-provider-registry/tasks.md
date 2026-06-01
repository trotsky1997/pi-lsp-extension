## 1. Registry Model

- [x] 1.1 Define provider manifest TypeScript types and Zod schemas for LSP, formatter, analyzer, and future provider kinds.
- [x] 1.2 Add validation errors that report provider id, source, and invalid field path.
- [x] 1.3 Add provider source metadata for built-in, workspace, adapter-compat, and code-backed providers.
- [x] 1.4 Document the initial manifest fields and the boundary between manifest-backed and code-backed providers.

## 2. Registry Loading

- [x] 2.1 Implement a `ProviderRegistry` that loads built-in manifests and code-backed registrations.
- [x] 2.2 Extend `openlsp.config.json` schema to accept `providers` while preserving existing `adapters` compatibility.
- [x] 2.3 Convert existing `adapters` entries into provider-compatible registry entries.
- [x] 2.4 Add duplicate-id and precedence handling for built-in, workspace, and adapter-compatible providers.

## 3. Selection and Compatibility Layer

- [x] 3.1 Rewire capability listing to read providers from `ProviderRegistry`.
- [x] 3.2 Add registry selection helpers for provider kind, file extension, file name, root markers, command preferences, and availability.
- [x] 3.3 Add compatibility adapters that expose registry-selected LSP providers to the existing LSP manager shape.
- [x] 3.4 Add compatibility adapters that expose registry-selected formatter providers to the existing formatter runner shape.
- [x] 3.5 Add compatibility adapters that expose registry-selected analyzer providers to the existing analyzer runner shape.

## 4. Initial Provider Migration

- [x] 4.1 Migrate at least one simple LSP provider to a manifest-backed definition.
- [x] 4.2 Migrate at least one simple formatter provider to a manifest-backed definition.
- [x] 4.3 Migrate at least one simple analyzer provider to a manifest-backed definition with a parser id or generic parser behavior.
- [x] 4.4 Keep complex providers code-backed and register their manifest metadata through the registry.
- [x] 4.5 Verify migrated providers keep their existing ids and command routing behavior.

## 5. Tests and Documentation

- [x] 5.1 Add tests for valid and invalid provider manifests.
- [x] 5.2 Add tests for workspace provider registration and capability output.
- [x] 5.3 Add tests for command preference selection and unavailable provider errors.
- [x] 5.4 Add tests proving legacy hardcoded providers and manifest-backed providers coexist during migration.
- [x] 5.5 Update README or migration docs with provider manifest examples and migration guidance.

## 6. Validation

- [x] 6.1 Run `bun run typecheck` from `openlsp-cli`.
- [x] 6.2 Run `bun test` from `openlsp-cli`.
- [x] 6.3 Run `openlsp-cli capabilities --json` and verify registry-backed metadata is present.
- [x] 6.4 Run a hook smoke command to ensure hook execution still uses provider-backed checks.
- [x] 6.5 Run `bun run build` from `openlsp-cli`.
