## Context

`openlsp-cli` now has a standalone source boundary, but provider definitions are still split across legacy core modules. LSP servers live in `LSP_SERVERS`, formatters live in `FORMATTERS`, analyzers live in `ANALYZERS`, and each list mixes declarative metadata with command construction and special-case behavior. The existing `adapters` config already hints at a manifest-driven model, but it is separate from the built-in provider path.

The next step is to create one provider registry abstraction that can describe simple providers declaratively and keep complex providers code-backed without exposing that complexity to command routing.

## Goals / Non-Goals

**Goals:**

- Define one manifest schema for built-in and configured providers across LSP, formatter, analyzer, and future provider kinds.
- Route capability listing and provider selection through one registry API.
- Let simple providers be added or overridden through config or manifest files without editing TypeScript arrays.
- Preserve existing CLI command behavior and response envelopes.
- Keep complex providers code-backed where they need custom discovery, process setup, install logic, or output parsing.
- Migrate a small representative provider set first so the pattern is proven without destabilizing every language at once.

**Non-Goals:**

- Migrating every existing provider out of TypeScript in the first implementation.
- Replacing the LSP session manager, formatter runner, analyzer runner, or tree-sitter engine.
- Designing a third-party plugin packaging system.
- Changing user-facing command names, hook syntax, or server endpoints.
- Removing current compatibility config fields before a migration path exists.

## Decisions

1. Introduce `ProviderManifest` as the canonical provider description.

   A provider manifest will include fields such as `id`, `kind`, `extensions`, `fileNames`, `rootMarkers`, `command`, `args`, `env`, `capabilities`, and optional handler identifiers such as `parser` or `resolver`. This captures the common provider surface while avoiding a lowest-common-denominator rewrite of complex providers.

   Alternative considered: keep separate `LspManifest`, `FormatterManifest`, and `AnalyzerManifest` schemas. That preserves type precision but repeats matching, validation, override, and capability code across three paths.

2. Split providers into manifest-backed and code-backed entries.

   Manifest-backed providers are plain data plus generic execution. Code-backed providers register a manifest for discovery and selection, then attach a named resolver, spawner, parser, or lifecycle handler from TypeScript. Examples likely to remain code-backed initially include PowerShellEditorServices, Kotlin, TypeScript tsdk discovery, and analyzers with nontrivial output parsing.

   Alternative considered: force every provider into JSON immediately. That would either make the manifest language too expressive or break providers that require runtime logic.

3. Keep the existing core runners but make them consume registry results.

   The first implementation should avoid replacing `LSPManager`, `runFormatterForFile`, or `runAnalyzersForFile`. Instead, introduce a registry adapter layer that can produce the same shapes those runners currently expect. Once selection is registry-backed, the internals can be simplified incrementally.

   Alternative considered: rewrite all runners around the new registry immediately. That is cleaner long term but too much behavioral surface for one change.

4. Treat `openlsp.config.json` provider entries as first-class providers.

   The config schema should accept provider definitions under a stable field such as `providers`, while continuing to honor existing `adapters` definitions during migration. Workspace providers should override or extend built-ins deterministically and appear in `capabilities`.

   Alternative considered: only load built-in manifests first. That reduces implementation scope, but it does not solve the user-visible problem of adding providers without code changes.

5. Migrate representative providers first.

   Start with simple, low-risk examples across the three kinds, such as `json-ls` or `taplo` for LSP, `prettier` or `taplo` for formatter, and `taplo-check` or `markdownlint` for analyzer. Keep more complex providers code-backed until generic execution and parsing are proven.

   Alternative considered: migrate all simple providers in one pass. That is tempting, but broadens the blast radius and makes regressions harder to attribute.

## Risks / Trade-offs

- Registry indirection can make provider behavior harder to trace -> Include source metadata, selected provider IDs, and tests around provider resolution.
- Manifest schema may not cover real providers cleanly -> Keep an escape hatch for named code-backed handlers instead of overfitting the schema.
- Existing `adapters` and new `providers` config can overlap -> Define deterministic precedence and test duplicate IDs.
- Partial migration leaves two internal representations temporarily -> Keep compatibility adapters small and add TODOs only where follow-up migration is needed.
- Analyzer output parsing is heterogeneous -> Require parser IDs for manifest-backed analyzers instead of embedding parser logic in config.

## Migration Plan

1. Add provider manifest schemas and registry types.
2. Implement a provider registry that loads built-in manifests, code-backed providers, `providers` config, and existing `adapters` config.
3. Rewire capability listing to use the registry.
4. Add compatibility adapters so existing LSP, formatter, and analyzer runners can consume registry-backed provider definitions.
5. Migrate a small representative provider set from hardcoded arrays to manifests and keep complex providers code-backed.
6. Add tests for validation, selection precedence, custom provider registration, and capability output.
7. Run standalone validation: `bun run typecheck`, `bun test`, capabilities smoke, hook smoke, and build.

## Open Questions

- Should built-in manifests be JSON files under `openlsp-cli/providers/` or TypeScript data modules under `src/providers/` for the first pass?
- Should `providers` supersede `adapters` immediately, or should `adapters` remain as an alias until archive of a later migration change?
- Which analyzer parser IDs should be considered stable enough for user-authored provider manifests?
