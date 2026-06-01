# openlsp-cli

`openlsp-cli` is a Bun-native, Zod-validated CLI for coding-agent workflows.
It extracts reusable language-intelligence orchestration from `lsp-pi` into a
standalone tool with a stable JSON protocol, OOP service boundaries, custom
adapter manifests, and Bun-native local or remote execution.

## Commands

```bash
bun run src/cli.ts lsp --operation diagnostics --file src/index.ts --json
bun run src/cli.ts lsp --operation goToDefinition \
  --file src/index.ts --line 12 --character 4 --json
bun run src/cli.ts format --file src/index.ts --json
bun run src/cli.ts analyze --file src/index.ts --json
bun run src/cli.ts config --json
bun run src/cli.ts capabilities --json
bun run src/cli.ts hook --event PostToolUse --check diagnostics --format claude
bun run src/cli.ts serve --host 127.0.0.1 --port 4317
```

## Config

By default the CLI loads `openlsp.config.json` from the workspace root.
Supported config features in this first extraction include:

- `extends` for reusable presets
- `lsp`, `formatter`, and `analyzer` sections for provider overrides
- `commands` for command-level adapter preferences such as a specific formatter
- `providers` for unified LSP, formatter, analyzer, or transport provider manifests
- `adapters` for validated custom formatter, analyzer, or transport manifests
- `remote` for server defaults

A Pi compatibility bridge can also inject canonical config through the
`OPENLSP_CONFIG_JSON` environment variable.

### Provider manifests

`providers` is the registry-backed replacement path for hardcoded provider
lists. Simple command-backed providers can be registered in config:

```json
{
  "providers": [
    {
      "id": "custom-markdown-analyzer",
      "kind": "analyzer",
      "runtime": "bun",
      "command": "markdownlint",
      "args": ["--json", "{file}"],
      "extensions": [".md", ".mdx"],
      "capabilities": ["analyze"],
      "parser": "plain"
    }
  ],
  "commands": {
    "analyze": {
      "analyzers": ["custom-markdown-analyzer"]
    }
  }
}
```

Initial manifest fields:

- `id`: stable provider id used in command preferences and metadata
- `kind`: `lsp`, `formatter`, `analyzer`, or `transport`
- `runtime`: `bun`, `legacy`, or `handler`
- `command` / `args` / `env`: generic command execution fields
- `extensions` / `fileNames` / `rootMarkers`: file and workspace matching metadata
- `capabilities`: provider capabilities such as `lsp`, `format`, or `analyze`
- `parser`: analyzer output parser id for command-backed analyzers
- `handler`: named TypeScript handler for providers that cannot be pure data

Most simple command providers should use manifests. Providers that need custom
binary discovery, install logic, LSP lifecycle behavior, or specialized output
parsing remain code-backed and register manifest metadata through the same
registry. Existing `adapters` config remains supported during migration and is
loaded as provider-compatible metadata.

## Agent hooks

`openlsp-cli hook` is a command-hook entrypoint for coding agents. It reads hook
event JSON from stdin, extracts changed source files from fields such as
`tool_input.file_path`, MCP tool arguments, and Codex `apply_patch` commands,
runs OpenLSP checks, and emits hook output.

### Codex

For Codex, use `--format codex`. OpenLSP reads Codex stdin fields such as
`cwd`, `hook_event_name`, `tool_name`, `tool_input`, and `tool_response`, then
returns findings as `hookSpecificOutput.additionalContext`.

Example `.codex/hooks.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|apply_patch|mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "openlsp-cli hook --format codex --check diagnostics",
            "commandWindows": "openlsp-cli.exe hook --format codex --check diagnostics",
            "timeout": 30,
            "statusMessage": "Checking OpenLSP diagnostics"
          }
        ]
      }
    ]
  }
}
```

Example `.codex/config.toml`:

```toml
[[hooks.PostToolUse]]
matcher = "Edit|Write|apply_patch|mcp__.*"

[[hooks.PostToolUse.hooks]]
type = "command"
command = "openlsp-cli hook --format codex --check diagnostics"
command_windows = "openlsp-cli.exe hook --format codex --check diagnostics"
timeout = 30
statusMessage = "Checking OpenLSP diagnostics"
```

Codex non-managed command hooks require `/hooks` review and trust before they
run. Automation can use `--dangerously-bypass-hook-trust` only when the hook
source is already vetted by the surrounding system.

### Claude Code

For Claude Code, use `--format claude` so findings are returned as
`hookSpecificOutput.additionalContext`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "bun",
            "args": [
              "run",
              "${CLAUDE_PROJECT_DIR}/openlsp-cli/src/cli.ts",
              "hook",
              "--event",
              "PostToolUse",
              "--check",
              "diagnostics",
              "--format",
              "claude",
              "--cwd",
              "${CLAUDE_PROJECT_DIR}"
            ],
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Use `--check analyze` for analyzer-only hooks or `--check both` to run
diagnostics and analyzers. Use `--format text` for hook systems that surface
stdout directly, or `--format json` for custom wrappers.

## Remote mode

`openlsp-cli serve` starts a Bun-native HTTP service.

- `GET /health` returns protocol metadata
- `POST /command` accepts the same JSON command envelope used locally
- session-aware requests reuse workspace-bound LSP state when possible

## Development

```bash
cd openlsp-cli
bun run typecheck
bun test
bun run src/cli.ts capabilities --json
bun run build
```
