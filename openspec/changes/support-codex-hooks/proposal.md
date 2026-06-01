## Why

OpenLSP's current hook entrypoint is shaped around Claude Code examples and only partially matches Codex's official hook protocol. Codex hooks are now a first-class extension point, so OpenLSP should provide deterministic diagnostics and analyzer context through Codex `PostToolUse` without requiring custom wrappers.

## What Changes

- Add first-class Codex hook output support via a `codex` hook format that emits Codex-compatible `hookSpecificOutput.additionalContext`.
- Infer the hook event name from Codex stdin payloads when `--event` is not supplied.
- Parse Codex `PostToolUse` payloads for `Bash`, `apply_patch`, and MCP tool calls, including changed file paths embedded in `tool_input.command`.
- Avoid injecting unsupported diagnostics noise as model-visible issues when no useful OpenLSP finding exists.
- Document Codex `hooks.json` and `config.toml` setup, including matcher guidance and trust-review requirements.
- Add standalone tests and smoke coverage for Codex hook payloads.

## Capabilities

### New Capabilities

- `codex-hook-integration`: Codex-compatible command hook execution for OpenLSP diagnostics and analyzer context.

### Modified Capabilities

- None.

## Impact

- Affects `openlsp-cli hook`, hook input parsing, hook output rendering, README setup examples, and standalone tests.
- Does not change the core command envelope for `lsp`, `format`, `analyze`, or remote server mode.
- No new runtime dependencies are expected.
