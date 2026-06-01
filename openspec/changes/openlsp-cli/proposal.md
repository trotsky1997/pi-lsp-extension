# openlsp-cli proposal

## Why

`lsp-pi` currently couples language intelligence, formatter and analyzer
orchestration, and Pi-specific tool wiring into one package. That makes it
hard to reuse the core engine outside Pi or evolve it into a standalone
coding-agent service. Extracting a Bun-native `openlsp-cli` now turns the
proven internals into a faster, general-purpose, configurable foundation that
can serve Pi, other agent runtimes, and remote workspace workflows from the
same core without carrying a Node-compat-first architecture.

## What Changes

- Create a standalone, Bun-native `openlsp-cli` CLI focused on coding-agent
  workflows such as diagnostics, symbol and navigation queries, formatting,
  analyzer runs, and workspace-aware configuration inspection.
- Reorganize the current TypeScript code into Bun-friendly, Zod-validated OOP
  modules with clear boundaries between CLI commands, service orchestration,
  config loading, transport, and provider adapters.
- Make Bun the primary runtime, package manager, test runner, and build target,
  using Bun-native process, file, server, and Web APIs instead of a
  Node-compat-first shim layer.
- Introduce a configuration model that supports local defaults, workspace
  overrides, reusable presets, and extension hooks for adding new providers or
  commands without forking the CLI.
- Add remote-ready execution primitives so the same CLI contract can target
  local workspaces today and evolve into client/server or daemon-backed remote
  workspaces without redesigning the command surface.
- Keep Pi integration possible through a thin adapter layer that reuses
  `openlsp-cli` instead of embedding all language intelligence logic directly
  in the Pi extension.

## Capabilities

### New Capabilities

- `openlsp-cli-runtime`: A standalone CLI runtime for coding agents with
  predictable commands, machine-readable output, and workspace-aware
  configuration resolution.
- `openlsp-cli-adapters`: A pluggable adapter system for LSP servers,
  formatters, analyzers, and future provider types using validated config
  schemas and extensible service objects.
- `openlsp-cli-remote-workspaces`: A transport and session model that allows
  the CLI contract to operate against local or remote workspaces with the same
  request and response semantics.

### Modified Capabilities

None.

## Impact

- Affects `lsp.ts`, `lsp-tool.ts`, `lsp-core.ts`, `lsp-settings.ts`,
  `formatter-core.ts`, and `analyzer-core.ts` because their responsibilities
  need to be split between reusable CLI core and Pi adapter code.
- Adds a new standalone package or package layout for `openlsp-cli`, likely
  with Bun entrypoints, Bun-native scripts, Zod schemas, and OOP service
  abstractions.
- Introduces new user-facing CLI APIs, config files, and machine-readable
  output contracts for coding agents.
- Requires migration guidance so the existing Pi extension can continue
  working while gradually delegating to the extracted CLI.
