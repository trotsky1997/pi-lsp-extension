## ADDED Requirements

### Requirement: Codex Hook Format

OpenLSP SHALL provide a Codex hook output format that emits JSON accepted by Codex command hooks for adding model-visible context.

#### Scenario: Codex additional context output

- **WHEN** `openlsp-cli hook --format codex` produces a non-empty hook message for a `PostToolUse` event
- **THEN** stdout MUST be a JSON object containing `hookSpecificOutput.hookEventName` and `hookSpecificOutput.additionalContext`

#### Scenario: Empty Codex hook result

- **WHEN** `openlsp-cli hook --format codex` finds no changed source files or no useful findings
- **THEN** the command MUST exit successfully without emitting misleading diagnostics context

### Requirement: Codex Event Name Inference

OpenLSP SHALL infer the active hook event name from Codex stdin payloads when the caller does not provide an explicit event name.

#### Scenario: Event name from stdin

- **WHEN** the hook input contains `hook_event_name: "PostToolUse"` and no `--event` flag is provided
- **THEN** OpenLSP MUST render `hookSpecificOutput.hookEventName` as `PostToolUse`

#### Scenario: Explicit event override

- **WHEN** the caller provides `--event UserPromptSubmit`
- **THEN** OpenLSP MUST render `hookSpecificOutput.hookEventName` as `UserPromptSubmit` regardless of the stdin event field

### Requirement: Codex Changed File Resolution

OpenLSP SHALL resolve source files from Codex hook payloads for direct file arguments, MCP tool arguments, and patch command text.

#### Scenario: MCP tool file argument

- **WHEN** a Codex hook payload contains an MCP `tool_input` with a source file path field
- **THEN** OpenLSP MUST include the existing source file in the hook check set

#### Scenario: Apply patch command

- **WHEN** a Codex `PostToolUse` payload has `tool_name: "apply_patch"` and `tool_input.command` contains `*** Update File:` or `*** Add File:` entries
- **THEN** OpenLSP MUST extract those file paths and include matching source files in the hook check set

#### Scenario: Deduplicated file list

- **WHEN** multiple Codex payload fields reference the same source file through different path spellings
- **THEN** OpenLSP MUST run at most one check per normalized file path

### Requirement: Hook Finding Filtering

OpenLSP SHALL only add model-visible hook context for meaningful diagnostics or analyzer findings.

#### Scenario: Unsupported diagnostics are filtered

- **WHEN** a hook diagnostics check returns an unsupported/no-provider response such as no LSP for a Markdown file
- **THEN** OpenLSP MUST treat that response as an empty hook finding rather than reporting an issue

#### Scenario: Real findings are preserved

- **WHEN** a hook diagnostics or analyzer check returns one or more real findings
- **THEN** OpenLSP MUST include the finding text in the hook message with the file name and check type

### Requirement: Codex Hook Documentation

OpenLSP SHALL document copyable Codex hook configuration examples and operational requirements.

#### Scenario: Hooks JSON example

- **WHEN** a user reads the OpenLSP hook documentation
- **THEN** the documentation MUST include a Codex `hooks.json` example using a command hook, `PostToolUse`, and matchers for `Edit`, `Write`, `apply_patch`, and MCP tools

#### Scenario: Config TOML example

- **WHEN** a user prefers inline Codex configuration
- **THEN** the documentation MUST include a Codex `config.toml` hook example with platform-appropriate command fields

#### Scenario: Trust review guidance

- **WHEN** a user installs project-local OpenLSP hooks
- **THEN** the documentation MUST explain that Codex non-managed command hooks require `/hooks` review and trust before they run
