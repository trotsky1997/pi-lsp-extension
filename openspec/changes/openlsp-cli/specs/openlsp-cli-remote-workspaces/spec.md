# openlsp-cli-remote-workspaces spec

## ADDED Requirements

### Requirement: Local and remote modes share one protocol envelope

The system SHALL use the same versioned request and response schema for local
execution and remote execution.

#### Scenario: Same command works across transports

- **WHEN** an agent sends the same logical diagnostics request through local
  mode and remote mode
- **THEN** both paths accept the same request fields and return the same result
  envelope shape
- **AND** transport-specific metadata is isolated to an optional metadata field

### Requirement: Remote server mode is exposed through Bun-native services

The system SHALL expose remote workspace serving through Bun-native server
capabilities while preserving the shared command protocol.

#### Scenario: Bun-native server mode starts successfully

- **WHEN** an operator starts `openlsp-cli serve` in a supported environment
- **THEN** the service accepts remote requests without requiring a separate
  Node HTTP wrapper
- **AND** the server advertises the protocol version it supports

#### Scenario: Bun-native remote service is unavailable

- **WHEN** a deployment environment cannot provide the Bun-native server
  capabilities required by remote mode
- **THEN** startup fails with a structured service compatibility error
- **AND** the failure explains which capability is missing

### Requirement: Remote mode supports workspace-bound sessions

The system SHALL allow a remote client to create, reuse, and close sessions
that are bound to a workspace root and resolved configuration.

#### Scenario: Remote session reuse

- **WHEN** a client opens a remote session for a workspace and sends multiple
  compatible requests
- **THEN** the remote service reuses the existing workspace session
- **AND** each response identifies the session that served the request

#### Scenario: Explicit session close

- **WHEN** a client requests session shutdown
- **THEN** the remote service releases provider resources for that session
- **AND** later requests require a new session or explicit reattachment

### Requirement: Remote failures are returned as structured command errors

The system MUST represent transport errors, timeouts, protocol mismatches, and
workspace access failures as structured errors that agents can inspect.

#### Scenario: Remote timeout

- **WHEN** a remote request exceeds the configured timeout
- **THEN** the client receives a timeout error with retryability metadata
- **AND** the error identifies the command and session involved

#### Scenario: Protocol version mismatch

- **WHEN** a client and remote service do not share a compatible protocol
  version
- **THEN** the handshake fails before command execution
- **AND** the response reports the supported protocol range
