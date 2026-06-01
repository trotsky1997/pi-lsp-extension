## 1. Hook Format and Event Handling

- [x] 1.1 Add `codex` to the hook output format type, CLI parser, and usage text.
- [x] 1.2 Infer the hook event name from `hook_event_name` in stdin when `--event` is not provided.
- [x] 1.3 Preserve explicit `--event` as an override over the stdin event name.
- [x] 1.4 Add tests for Codex event inference and explicit event override.

## 2. Codex File Resolution

- [x] 2.1 Add a parser for Codex `apply_patch` command text that extracts `Add File`, `Update File`, `Delete File`, and `Move to` paths.
- [x] 2.2 Integrate patch-derived paths with the existing recursive hook file candidate resolver.
- [x] 2.3 Ensure MCP-style `tool_input` file/path/uri fields continue to resolve through the shared resolver.
- [x] 2.4 Deduplicate resolved files by normalized absolute path while preserving the configured `maxFiles` limit.
- [x] 2.5 Add tests for `apply_patch`, MCP file arguments, relative paths, file URIs, and duplicates.

## 3. Hook Finding Filtering

- [x] 3.1 Classify unsupported/no-provider diagnostics responses as empty hook results.
- [x] 3.2 Keep real diagnostics, analyzer findings, and OpenLSP execution failures visible in hook output.
- [x] 3.3 Suppress Codex/Claude JSON stdout when the hook result has no useful findings.
- [x] 3.4 Add tests for Markdown unsupported diagnostics filtering and real finding preservation.

## 4. Codex Documentation

- [x] 4.1 Add a Codex `hooks.json` example for `PostToolUse` with `Edit|Write|apply_patch|mcp__.*` matcher guidance.
- [x] 4.2 Add a Codex inline `config.toml` example, including Windows command field guidance.
- [x] 4.3 Document `/hooks` trust review and `--dangerously-bypass-hook-trust` automation caveat.
- [x] 4.4 Keep Claude Code hook documentation separate from Codex-specific examples.

## 5. Validation

- [x] 5.1 Run `bun run typecheck` in `openlsp-cli`.
- [x] 5.2 Run `bun test` in `openlsp-cli`.
- [x] 5.3 Run a Codex-shaped `PostToolUse` hook smoke with `apply_patch` input and confirm `--format codex` output.
- [x] 5.4 Run a no-finding Codex hook smoke and confirm stdout is empty.
- [x] 5.5 Run `bun run build` and verify the compiled CLI accepts `hook --format codex`.
