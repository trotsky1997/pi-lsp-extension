## ADDED Requirements

### Requirement: Unified provider manifests

The system SHALL define a validated provider manifest model that can describe LSP, formatter, analyzer, and future provider kinds.

#### Scenario: Valid manifest is accepted

- **WHEN** a provider manifest includes the required identity, kind, matching, and execution fields for its provider kind
- **THEN** the registry accepts the manifest and makes the provider available for selection

#### Scenario: Invalid manifest is rejected

- **WHEN** a provider manifest is missing a required field or uses an unsupported kind, runtime, parser, or resolver identifier
- **THEN** provider loading fails with a structured error that identifies the provider id and invalid field path

### Requirement: Registry loads built-in and configured providers

The system SHALL load providers from built-in manifests, code-backed registrations, and workspace configuration through one registry API.

#### Scenario: Built-in providers are available

- **WHEN** `openlsp-cli` starts without workspace provider configuration
- **THEN** the registry exposes the built-in LSP, formatter, and analyzer providers required by existing commands

#### Scenario: Workspace provider is registered

- **WHEN** `openlsp.config.json` declares a valid provider manifest
- **THEN** the registry includes that provider for the current workspace
- **AND** `capabilities` output identifies it as workspace-configured

#### Scenario: Existing adapter config remains compatible

- **WHEN** `openlsp.config.json` declares an existing `adapters` entry
- **THEN** the registry treats the adapter as a provider-compatible entry during the migration

### Requirement: Provider selection is registry-backed

The system SHALL select LSP, formatter, and analyzer providers through the provider registry using file context, command intent, workspace overrides, and provider availability.

#### Scenario: File extension selects matching provider

- **WHEN** a command targets a file whose extension matches one or more provider manifests
- **THEN** the registry returns the eligible providers for that command kind

#### Scenario: Command preference selects provider

- **WHEN** workspace config explicitly selects a formatter, analyzer, or LSP provider for a command
- **THEN** the registry selects that provider when it is eligible and available

#### Scenario: Required provider is unavailable

- **WHEN** command config selects a provider whose manifest is known but whose command or runtime cannot be resolved
- **THEN** the command returns a structured error naming the unavailable provider

### Requirement: Code-backed providers integrate with manifests

The system SHALL support providers whose manifest metadata is declarative but whose execution requires named TypeScript handlers.

#### Scenario: Code-backed provider is listed

- **WHEN** a code-backed provider is registered with manifest metadata and a handler id
- **THEN** capability output lists the provider with its kind, source, matching metadata, and handler-backed runtime

#### Scenario: Code-backed provider executes through handler

- **WHEN** the registry selects a code-backed provider
- **THEN** command execution delegates to the registered handler rather than generic command execution

### Requirement: Capabilities report registry metadata

The system SHALL report provider capabilities from the registry rather than separately enumerating hardcoded LSP, formatter, and analyzer arrays.

#### Scenario: Capabilities include provider source

- **WHEN** a caller runs `openlsp-cli capabilities --json`
- **THEN** each provider capability includes the provider id, kind, source, extensions or file names, capabilities, and runtime or handler mode

#### Scenario: Migrated provider keeps capability identity

- **WHEN** an existing hardcoded provider is migrated to a manifest-backed provider
- **THEN** `capabilities` continues to report the same provider id and command routing semantics

### Requirement: Incremental migration preserves behavior

The system SHALL allow hardcoded legacy providers and manifest-backed providers to coexist during the migration.

#### Scenario: Legacy provider remains selectable

- **WHEN** a provider has not yet been migrated to a manifest-backed definition
- **THEN** existing commands can still select and execute that provider through the registry compatibility layer

#### Scenario: Representative providers are manifest-backed

- **WHEN** the first registry migration is complete
- **THEN** at least one LSP provider, one formatter provider, and one analyzer provider are loaded from manifests rather than direct hardcoded arrays
