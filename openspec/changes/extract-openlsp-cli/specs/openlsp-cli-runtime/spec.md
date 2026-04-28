## ADDED Requirements

### Requirement: CLI Commands Use a Validated Request Model
The CLI SHALL validate supported commands before execution and SHALL reject malformed command requests with a structured error.

#### Scenario: Running a valid LSP request
- **WHEN** a caller runs `openlsp-cli lsp` with a supported operation and required arguments
- **THEN** the CLI validates the request and dispatches it through the command service

#### Scenario: Running an invalid request
- **WHEN** a caller omits a required command argument such as `filePath` for a file-scoped operation
- **THEN** the CLI returns a non-zero exit status and a structured validation error

### Requirement: Command Responses Use JSON Envelopes
The runtime SHALL return a stable envelope for every command result, including protocol version, status, runtime, mode, command, workspace metadata, command metadata, and either data or error details.

#### Scenario: Requesting JSON output
- **WHEN** a caller passes `--json` to a supported command
- **THEN** stdout contains a JSON envelope with either `status: "ok"` and `data` or `status: "error"` and `error`

#### Scenario: Requesting text output
- **WHEN** a caller runs a supported command without `--json`
- **THEN** stdout or stderr contains the human-readable text derived from the same envelope result

### Requirement: Config Resolution Is Project Native
The runtime SHALL resolve configuration from command flags, the workspace root, `openlsp.config.json`, inherited config files, defaults, and explicit inline environment config without reading `.pi/settings.json`.

#### Scenario: Loading workspace config
- **WHEN** a workspace contains `openlsp.config.json`
- **THEN** the runtime loads and validates it as part of the effective OpenLSP config

#### Scenario: Loading inherited config
- **WHEN** `openlsp.config.json` declares `extends`
- **THEN** the runtime loads inherited files before applying the local config

#### Scenario: Avoiding Pi settings
- **WHEN** a workspace contains `.pi/settings.json`
- **THEN** the standalone CLI does not read that file as part of project-native config resolution

### Requirement: Server Mode Exposes Command Execution
The runtime SHALL provide a Bun-native server mode with health and command endpoints that use the same request and response schema as local execution.

#### Scenario: Checking server health
- **WHEN** a caller sends `GET /health` to a running server
- **THEN** the server returns protocol metadata and an ok status

#### Scenario: Executing a remote command
- **WHEN** a caller sends a valid command envelope to `POST /command`
- **THEN** the server executes it through the command service and returns a JSON command envelope

### Requirement: Sessions Reuse Workspace LSP State
The runtime SHALL support session reuse and session close operations for workspace-bound LSP state.

#### Scenario: Reusing a session
- **WHEN** two compatible LSP requests target the same workspace and effective config
- **THEN** the runtime can reuse the same session and report the session id in the response envelope

#### Scenario: Closing a session
- **WHEN** a caller runs `session-close` with an active session id
- **THEN** the runtime shuts down that session and reports that it was closed
