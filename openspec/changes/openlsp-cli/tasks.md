# openlsp-cli tasks

## 1. Bun-native foundation

- [x] 1.1 Create the `openlsp-cli` package layout, Bun entrypoints, and
  Bun-native scripts for development, build, and test flows.
- [x] 1.2 Define the canonical Zod schemas for CLI requests, responses,
  config files, adapter manifests, and protocol versioning.
- [x] 1.3 Add Bun-native runtime utilities for filesystem access,
  subprocess execution, structured logging, and JSON output handling.

## 2. Core services and command surface

- [x] 2.1 Extract the current LSP, formatter, and analyzer orchestration into
  OOP core services such as workspace, command, adapter, and session
  managers.
- [x] 2.2 Implement agent-facing CLI commands for diagnostics, navigation,
  symbol inspection, formatting, analyzer execution, config resolution, and
  capability inspection.
- [x] 2.3 Ensure every command supports deterministic text output and
  machine-readable `--json` output with structured errors and metadata.

## 3. Adapter system and lifecycle management

- [x] 3.1 Build the adapter registry and selection pipeline for LSP,
  formatter, analyzer, and future provider types using validated manifests.
- [x] 3.2 Implement Bun-native managed adapter lifecycle services for
  process startup, reuse, health checks, disposal, and incompatibility
  reporting.
- [x] 3.3 Add tests that verify workspace overrides, missing adapter
  failures, warm-session reuse, and Bun-runtime compatibility checks.

## 4. Remote workspaces and Pi migration

- [x] 4.1 Implement the shared request and response protocol for local
  execution and remote session-oriented execution.
- [x] 4.2 Add `openlsp-cli serve` with Bun-native server mode,
  workspace-bound sessions, timeout handling, and protocol negotiation.
- [x] 4.3 Rewire the Pi integration into a thin adapter that maps
  `.pi/settings.json` to the new config model and delegates core operations
  to `openlsp-cli`.
- [x] 4.4 Write migration and usage docs covering Bun-native installation,
  config structure, remote workflows, and Pi compatibility boundaries.
