# openlsp-cli-adapters spec

## ADDED Requirements

### Requirement: Adapter definitions are validated before execution

The system SHALL load built-in and custom adapters only after validating their
manifests, command hooks, and configuration schemas.

#### Scenario: Invalid custom adapter definition

- **WHEN** a workspace config references a custom adapter with missing required
  manifest fields
- **THEN** configuration loading fails before the command executes
- **AND** the error identifies the adapter name and invalid field path

#### Scenario: Valid adapter registration

- **WHEN** a custom adapter manifest and config satisfy the declared schema
- **THEN** the adapter becomes available to command routing in the current
  workspace
- **AND** the resolved capability list includes that adapter

### Requirement: Adapter execution uses Bun-native runtime services

The system SHALL execute adapter lifecycle operations through Bun-native
subprocess, file, and stream services, with any compatibility code isolated to
explicit integration boundaries.

#### Scenario: Managed adapter process starts through Bun runtime services

- **WHEN** the CLI starts an LSP, formatter, or analyzer adapter
- **THEN** the adapter is launched through the Bun-native runtime service layer
- **AND** the session metadata records the adapter and runtime service used

#### Scenario: Adapter requires unsupported runtime behavior

- **WHEN** an adapter depends on runtime behavior that the Bun-native service
  layer cannot provide
- **THEN** the CLI returns a structured incompatibility error for that adapter
- **AND** the failure is reported before command routing falls back to ad hoc
  spawning logic

### Requirement: Adapters are selected by capability and workspace context

The system SHALL choose LSP, formatter, analyzer, and future provider adapters
based on file type, workspace settings, command intent, and adapter
availability.

#### Scenario: Formatter selection honors workspace override

- **WHEN** a TypeScript file matches multiple formatter adapters and the
  workspace config explicitly selects one formatter
- **THEN** the selected formatter adapter handles the request
- **AND** the result metadata records which adapter was chosen

#### Scenario: Required adapter is unavailable

- **WHEN** a command requires an adapter whose binary or endpoint is not
  available
- **THEN** the CLI returns a structured error that names the missing adapter
- **AND** the command does not silently fall back to an unrelated provider

### Requirement: Long-lived adapters use managed service lifecycles

The system SHALL create, reuse, health-check, and dispose long-lived adapter
sessions through managed service objects rather than ad hoc process spawning.

#### Scenario: Repeated LSP requests reuse a warm session

- **WHEN** a caller sends multiple compatible language-service requests for the
  same workspace and configuration
- **THEN** the command router reuses the existing managed session
- **AND** the response metadata indicates that a warm session was reused

#### Scenario: Managed adapter becomes unhealthy

- **WHEN** a managed adapter process exits unexpectedly or fails a health check
- **THEN** the session manager marks that adapter instance unhealthy
- **AND** the next eligible request creates a fresh replacement session
