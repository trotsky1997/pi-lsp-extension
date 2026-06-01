# openlsp-cli-runtime spec

## ADDED Requirements

### Requirement: Agent-facing commands use a stable execution contract

The system SHALL expose dedicated CLI commands for diagnostics, symbol
inspection, navigation, formatting, analyzer execution, and configuration
resolution using consistent argument handling and exit semantics.

#### Scenario: Successful JSON invocation

- **WHEN** an agent runs a supported command with `--json`
- **THEN** the CLI returns one JSON result document that includes the command
  name, protocol version, workspace metadata, and command payload
- **AND** the process exits with code `0`

#### Scenario: Invalid arguments

- **WHEN** an agent provides malformed or incomplete arguments
- **THEN** the CLI returns a structured validation error
- **AND** the process exits with a non-zero code without emitting partial
  result data

### Requirement: The CLI is Bun-native by default

The system SHALL treat Bun as the primary runtime and toolchain for command
execution, packaging, testing, and build workflows instead of relying on a
Node-compat-first architecture.

#### Scenario: Command executes under Bun

- **WHEN** an agent runs a supported command through a Bun entrypoint
- **THEN** the CLI executes without requiring a separate Node bootstrap layer
- **AND** runtime metadata can identify that the request was served by Bun

#### Scenario: Required Bun runtime feature is unavailable

- **WHEN** a command needs a Bun-native runtime capability that is not
  available in the current environment
- **THEN** the CLI fails fast with a structured runtime compatibility error
- **AND** it does not silently switch to an unrelated Node-only execution path

### Requirement: Workspace configuration is resolved deterministically

The system SHALL resolve command configuration from an explicit `--config`
path, the workspace `openlsp.config.json`, inherited presets, and built-in
defaults in a deterministic precedence order.

#### Scenario: Explicit config overrides workspace defaults

- **WHEN** a workspace contains `openlsp.config.json` and the caller also
  passes `--config ./tmp/agent.json`
- **THEN** the CLI uses the explicit config as the highest-precedence source
- **AND** the resolved config metadata identifies every source that contributed
  to the final settings

#### Scenario: No workspace config is present

- **WHEN** a caller runs a command in a workspace without an `openlsp`
  configuration file
- **THEN** the CLI falls back to built-in defaults
- **AND** the command still reports which defaults were applied

### Requirement: Machine-readable mode stays free of presentation noise

The system MUST keep `--json` output free of ANSI color codes, progress spinners,
and unrelated log lines so coding agents can parse responses deterministically.

#### Scenario: JSON mode with warnings

- **WHEN** a command succeeds but needs to report warnings
- **THEN** the warnings are included inside the JSON result envelope
- **AND** no extra text is written to stdout outside that JSON document
