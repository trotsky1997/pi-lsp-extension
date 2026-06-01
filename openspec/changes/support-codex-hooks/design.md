## Context

`openlsp-cli hook` currently reads hook event JSON from stdin, extracts likely source files, runs diagnostics/analyzers, and can emit Claude-compatible `hookSpecificOutput.additionalContext`. Codex command hooks use a similar stdout shape for model-visible context, but their configuration shape, stdin fields, matcher aliases, and `apply_patch` payloads differ enough that OpenLSP needs explicit Codex support rather than relying on the Claude path by convention.

Codex hooks are command hooks discovered from `hooks.json` or inline `[hooks]` tables. A Codex hook receives a JSON object on stdin with common fields such as `cwd`, `hook_event_name`, and event-specific fields such as `tool_name`, `tool_input`, and `tool_response`. For `Bash` and `apply_patch`, relevant file paths may only exist inside `tool_input.command`; MCP tools usually expose arguments directly in `tool_input`.

## Goals / Non-Goals

**Goals:**

- Make `openlsp-cli hook --format codex` a first-class Codex hook target.
- Correctly infer the hook event name from Codex stdin when `--event` is omitted.
- Extract changed source files from Codex `PostToolUse` payloads for direct file arguments, MCP arguments, and `apply_patch` command text.
- Return Codex-compatible JSON that adds useful model-visible context without injecting unsupported/no-op diagnostics noise.
- Document copyable Codex `hooks.json` and `config.toml` examples.
- Add tests using Codex-shaped fixtures.

**Non-Goals:**

- Implement policy decisions for `PreToolUse` or `PermissionRequest`; OpenLSP's hook remains a context-producing diagnostics/analyzer integration.
- Parse every possible shell command into file writes. The shell path extraction should stay conservative.
- Change Claude Code hook behavior except where shared parsing and noise filtering improve both formats.
- Add a daemon or long-running hook transport; this change keeps command-hook execution.

## Decisions

1. Add `codex` as an explicit hook output format.

   `codex` will initially emit the same `hookSpecificOutput.additionalContext` JSON shape as `claude`, because Codex accepts that shape for `PostToolUse` and other context-producing hooks. Keeping a distinct format name avoids misleading docs and gives room for future Codex-only fields such as `continue`, `decision`, or `systemMessage`.

   Alternative considered: Keep recommending `--format claude` for Codex. Rejected because it hides protocol ownership and encourages copying Claude-specific config examples.

2. Infer event name from input unless overridden by CLI.

   The CLI should pass an optional event override into the hook runner. If no explicit `--event` is provided, rendering should use `input.hook_event_name` when present, then fall back to `PostToolUse`. This matches Codex stdin while preserving current CLI behavior.

   Alternative considered: Require every Codex config to pass `--event PostToolUse`. Rejected because Codex already provides the event name and requiring duplication creates easy drift.

3. Parse file candidates with protocol-aware extractors plus the existing recursive fallback.

   The extraction path should first handle known Codex forms:

   - `tool_input.file_path`, `filePath`, `path`, `uri`, and nested MCP argument fields
   - `tool_input.command` for `apply_patch`, including `*** Add File:`, `*** Update File:`, `*** Delete File:`, and `*** Move to:`
   - conservative shell command file candidates for simple edit/write commands only if they point to existing source files

   The current recursive extractor remains useful for MCP tools and Claude-shaped events, but it cannot parse patch commands by itself.

   Alternative considered: Parse transcripts to discover changed files. Rejected because Codex documents transcript format as unstable hook input.

4. Treat unsupported OpenLSP checks as empty hook findings.

   Hook context should only be injected when it helps the agent. Diagnostics envelopes that format as unsupported/no LSP/no analyzer provider should not count as issues. Actual command errors should remain visible in `json` output and can be surfaced in text if they indicate OpenLSP failed rather than "no provider for this file".

   Alternative considered: Always report unsupported status. Rejected because hooks run frequently and noisy context reduces agent quality.

5. Keep hook execution bounded and deterministic.

   Maintain `maxFiles`, timeout defaults, and sequential per-file checks. This avoids surprising resource use when Codex runs multiple matching hooks concurrently.

## Risks / Trade-offs

- [Codex protocol drift] Codex hooks are evolving and field names may change -> Keep Codex support isolated behind parser tests and document the source assumptions.
- [Patch parser false positives] Patch-like text may include paths that are not intended as files -> Resolve candidates against `cwd`, require supported source extensions, and require the file to exist except for added files once creation has completed.
- [Noisy hook context] Returning "no diagnostics" or unsupported messages can distract the model -> Filter empty/unsupported results before building `additionalContext`.
- [Windows command quoting] Codex config examples differ between Unix and Windows -> Document both `command` and `commandWindows`/`command_windows` forms.
- [Concurrent hook runs] Codex may launch multiple matching command hooks concurrently -> Avoid shared mutable files and keep all output on stdout as a single JSON object.
