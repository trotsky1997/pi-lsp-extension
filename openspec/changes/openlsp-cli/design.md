# openlsp-cli design

## Context

The current repository packages three concerns together: Pi extension wiring,
workspace-level orchestration for LSP, formatters, and analyzers, and the
provider-specific process lifecycle needed to serve requests. That structure
works for `lsp-pi`, but it makes reuse difficult because every consumer must
adopt Pi's tool model and settings layout.

The proposed change extracts a standalone `openlsp-cli` that keeps the proven
language-intelligence behavior while making it usable by any coding agent. The
new tool must stay fast, keep the current config-first philosophy, allow new
provider types, support a future remote execution model without changing its
command contract, and treat Bun as the primary platform rather than a
best-effort compatibility target.

Key constraints:

- Existing Pi users must keep a viable migration path.
- LSP, formatter, and analyzer behavior must remain workspace-aware.
- Configuration must be validated and predictable for agent callers.
- Runtime services must be Bun-native for process execution, file access,
  build and test workflows, and server mode.
- Remote support must start with a stable transport contract, not an ad hoc
  shell wrapper.

## Goals / Non-Goals

**Goals:**

- Extract a standalone Bun-native CLI that can run outside Pi.
- Define a stable machine-readable contract for agent-facing commands.
- Separate core orchestration from presentation and integration layers.
- Make providers configurable and extensible through validated schemas.
- Support both local and remote workspace execution through one request model.
- Use Bun as the primary runtime, package manager, test runner, and build
  target.
- Preserve enough compatibility for the Pi extension to become a thin adapter.

**Non-Goals:**

- Rewriting every built-in provider from scratch.
- Delivering a full hosted multi-tenant remote platform in the first cut.
- Replacing Pi-specific UX features that belong in the extension layer.
- Auto-installing third-party language servers or analyzers.
- Supporting Node-first packaging or duplicated cross-runtime abstractions in
  the first extraction.
- Solving cross-machine auth, billing, or fleet management in this change.

## Decisions

### 1. Split the codebase into core, CLI, and integration layers

`openlsp-cli` will be organized around a reusable core and thin frontends:

- `openlsp-core`: domain services such as workspace resolution, command
  routing, adapter lifecycle, session management, and structured results.
- `openlsp-cli`: Bun entrypoints that parse args, load config, execute
  commands, and render human or JSON output.
- `pi-openlsp-adapter`: the existing Pi-facing integration rewritten to call
  the CLI/core contract instead of owning the full orchestration stack.

This split keeps most complexity in one reusable place while avoiding a second
copy of business logic in Pi-specific files.

**Alternatives considered:**

- Keep one package and add more entrypoints. Rejected because Pi-specific and
  generic concerns would stay entangled.
- Extract only helper functions. Rejected because transport, lifecycle, and
  command contracts need clearer ownership than utility modules provide.

### 2. Treat Bun as the primary runtime, not a fallback target

`openlsp-cli` will standardize on Bun-native primitives for its core runtime:

- `Bun.spawn` and related subprocess APIs for provider lifecycle management
- `Bun.file` and Bun's file APIs for config and artifact access
- Bun's built-in web platform APIs for fetch, request handling, and
  WebSocket-capable server mode
- `bun test` and Bun-driven scripts for package verification

Any Node interoperability will be isolated to explicit integration boundaries,
such as the Pi adapter, instead of shaping the internal architecture.

**Alternatives considered:**

- Keep the core on generic Node APIs so it can run anywhere. Rejected because
  the user explicitly wants a Bun-native tool, and a lowest-common-denominator
  runtime would weaken performance and design clarity.
- Build a Bun wrapper around a Node-first core. Rejected because it would keep
  the same coupling and compatibility baggage this extraction is meant to
  remove.

### 3. Use Zod-backed OOP services as the primary extension boundary

The extracted system will use explicit service objects such as
`WorkspaceService`, `CommandService`, `SessionService`, and `AdapterRegistry`.
Each service consumes Zod-validated config and request objects. Provider types
such as LSP servers, formatters, analyzers, and transports plug into these
services through typed interfaces and manifests.

This preserves strong validation at module boundaries while making lifecycle
management clearer than a purely functional, shared-state design.

**Alternatives considered:**

- A mostly functional module graph with shared singleton maps. Rejected because
  session reuse, remote attachments, and adapter disposal become harder to
  reason about.
- Runtime duck typing for adapters. Rejected because invalid plugins would fail
  late and produce poor agent-facing errors.

### 4. Define one command contract for human and machine callers

Every command will expose the same logical operations in text mode and `--json`
mode. JSON mode will emit a single structured result envelope containing:

- command identity and protocol version
- workspace and session metadata
- primary payload data
- diagnostics, warnings, or structured errors
- timing and backend metadata

The initial command surface should cover the workflows already proven in this
repository: diagnostics, symbol discovery, navigation, formatting, analyzer
execution, config resolution, and session or capability inspection.

**Alternatives considered:**

- Separate human and API commands. Rejected because it doubles maintenance and
  invites drift.
- A single generic `run` command with opaque payloads. Rejected because agents
  and humans both benefit from discoverable subcommands and typed arguments.

### 5. Make configuration explicit, layered, and portable

The canonical CLI config will live outside Pi-specific settings. The CLI will
support:

- an explicit `--config` path
- workspace `openlsp.config.json` as the default project entrypoint
- optional preset inheritance through `extends`
- per-provider and per-command overrides
- namespaced extension data for custom adapters

A compatibility loader in the Pi adapter can translate `.pi/settings.json`
values into the canonical config until users migrate.

**Alternatives considered:**

- Keep `.pi/settings.json` as the only config format. Rejected because the CLI
  must be usable without Pi.
- Allow arbitrary executable config files first. Rejected because predictable,
  remote-safe config is more important than maximum flexibility in v1.

### 6. Start remote support with a transport-neutral protocol

Remote execution will be introduced through a versioned request and response
schema that works for both local and remote transports. The first transport
pair will be:

- local in-process or subprocess execution for direct CLI use
- server mode via `openlsp-cli serve` with session-oriented request handling

Remote clients will send the same command envelope used locally and receive the
same structured result envelope. Sessions will be keyed by workspace root and
resolved config so repeated requests can reuse expensive provider state.

**Alternatives considered:**

- Build HTTP-only endpoints first. Rejected because stdio and local subprocess
  transports are simpler for agent integration and testing.
- Delay remote design entirely. Rejected because remoteability affects command
  envelopes, session identity, and error handling from the start.

## Risks / Trade-offs

- [Migration drift] Existing Pi behavior may diverge during extraction -> Keep
  a thin compatibility layer and add parity tests for core operations.
- [Bun-native gaps] Some provider workflows may still assume Node semantics ->
  Isolate runtime services and validate critical flows under Bun early.
- [Config sprawl] Extensibility can make config hard to reason about -> Keep a
  small canonical schema and reserve namespaced escape hatches for extensions.
- [Remote latency] Networked sessions can make agent feedback slower -> Reuse
  sessions, expose timing metadata, and support explicit timeout controls.
- [Lifecycle leaks] Long-lived LSP sessions may outlive their usefulness -> Put
  creation, reuse, health checks, and disposal behind one session manager.

## Migration Plan

1. Identify reusable logic in the current repo and move it behind core service
   interfaces without changing behavior.
2. Introduce Bun-native package structure, scripts, and test coverage, then
   implement the initial local commands in JSON and text modes.
3. Move provider registration and config resolution to the new canonical
   schema, then add compatibility mapping for `.pi/settings.json`.
4. Rewire the Pi integration to call the extracted core or CLI contract and
   verify parity with the current tool and hook flows.
5. Add Bun-native server mode and remote session handling once local parity is
   stable.
6. Publish migration notes that explain config changes, new command usage, and
   compatibility boundaries.

Rollback strategy: keep the current Pi adapter path functional until the new
CLI reaches feature parity, so the repository can temporarily fall back to the
existing in-process orchestration if extraction exposes regressions.

## Open Questions

- Should the first canonical config format stay JSON-only, or should TOML be
  supported from day one for parity with other tooling ecosystems?
- Should remote server mode begin with stdio only, or should Bun's HTTP server
  entrypoint be included in the first release for easier cross-machine
  orchestration?
- Does the extraction belong in this repository as a workspace package, or as a
  sibling repository with this package consuming it as a dependency?
