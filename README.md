# LSP Extension

Language Server Protocol integration for pi-coding-agent.

## Highlights

- **Hook** (`lsp.ts`): Auto-diagnostics (default at agent end; optional per `write`/`edit`)
- **Tool** (`lsp-tool.ts`): Claude-style on-demand LSP queries plus preserved Pi extras
- Manages one LSP server per project root and reuses them across turns
- **Efficient**: Bounded memory usage via LRU cache and idle file cleanup
- Supports TypeScript/JavaScript, Vue, Svelte, Dart/Flutter, Python, Go, Kotlin, Swift, and Rust

## Supported Languages

| Language | Server | Detection |
|----------|--------|-----------|
| TypeScript/JavaScript | `typescript-language-server` | `package.json`, `tsconfig.json` |
| Vue | `vue-language-server` | `package.json`, `vite.config.ts` |
| Svelte | `svelteserver` | `svelte.config.js` |
| Dart/Flutter | `dart language-server` | `pubspec.yaml` |
| Python | `pyright-langserver` | `pyproject.toml`, `requirements.txt` |
| Go | `gopls` | `go.mod` |
| Kotlin | `kotlin-ls` | `settings.gradle(.kts)`, `build.gradle(.kts)`, `pom.xml` |
| Swift | `sourcekit-lsp` | `Package.swift`, Xcode (`*.xcodeproj` / `*.xcworkspace`) |
| Rust | `rust-analyzer` | `Cargo.toml` |

### Known Limitations

**rust-analyzer**: Very slow to initialize (30-60+ seconds) because it compiles the entire Rust project before returning diagnostics. This is a known rust-analyzer behavior, not a bug in this extension. For quick feedback, consider using `cargo check` directly.

## Usage

### Installation

Install the package and enable extensions:
```bash
pi install npm:lsp-pi
pi config
```

Dependencies are installed automatically during `pi install`.

### Prerequisites

Install the language servers you need:

```bash
# TypeScript/JavaScript
npm i -g typescript-language-server typescript

# Vue
npm i -g @vue/language-server

# Svelte
npm i -g svelte-language-server

# Python
npm i -g pyright

# Go (install gopls via go install)
go install golang.org/x/tools/gopls@latest

# Kotlin (kotlin-ls)
brew install JetBrains/utils/kotlin-lsp

# Swift (sourcekit-lsp; macOS)
# Usually available via Xcode / Command Line Tools
xcrun sourcekit-lsp --help

# Rust (install via rustup)
rustup component add rust-analyzer
```

The extension spawns binaries from your PATH.

## How It Works

### Hook (auto-diagnostics)

1. On `session_start`, warms up LSP for detected project type
2. Tracks files touched by `write`/`edit`
3. Default (`agent_end`): at agent end, sends touched files to LSP and posts a diagnostics message
4. Optional (`edit_write`): per `write`/`edit`, appends diagnostics to the tool result
5. Shows notification with diagnostic summary
6. **Memory Management**: Keeps up to 30 files open per LSP server (LRU eviction), automatically closes idle files (> 60s), and shuts down all LSP servers after 2 minutes of post-agent inactivity (servers restart lazily when files are read again).
7. **Robustness**: Reuses cached diagnostics if a server doesn't re-publish them for unchanged files, avoiding false timeouts on re-analysis.
8. **Workspace updates**: `write` / `edit` operations now emit workspace file-change notifications to active language servers, and project config file changes trigger a restart of affected active server roots so they reload config.

### Tool (on-demand queries)

The `lsp` tool now uses a Claude-style `operation` interface.

Inputs are validated with strict Zod discriminated-union schemas, so missing required fields and legacy extra keys are rejected early.
Capability-gated operations such as call hierarchy, type definition, and prepare rename are only invoked when the active server advertises support.

Core Claude-style operations:

| Operation | Description | Requires |
|-----------|-------------|----------|
| `goToDefinition` | Jump to definition | `filePath` + `line` + `character` |
| `findReferences` | Find all references | `filePath` + `line` + `character` |
| `hover` | Get type/docs info | `filePath` + `line` + `character` |
| `documentHighlight` | Highlight occurrences of the symbol in the current document | `filePath` + `line` + `character` |
| `documentSymbol` | List symbols in a file | `filePath` + `line` + `character` |
| `workspaceSymbol` | List workspace symbols for the file's workspace | `filePath` + `line` + `character` |
| `goToImplementation` | Jump to implementation | `filePath` + `line` + `character` |
| `typeDefinition` | Jump to the symbol's type definition | `filePath` + `line` + `character` |
| `prepareCallHierarchy` | Inspect the callable item at a position | `filePath` + `line` + `character` |
| `incomingCalls` | Show callers of a symbol | `filePath` + `line` + `character` |
| `outgoingCalls` | Show callees of a symbol | `filePath` + `line` + `character` |

Preserved Pi-specific operations under the same `operation` field:

| Operation | Description | Requires |
|-----------|-------------|----------|
| `diagnostics` | Get single-file diagnostics | `filePath`, optional `severity` |
| `workspaceDiagnostics` | Get diagnostics for multiple files | `filePaths`, optional `severity` |
| `signatureHelp` | Get function signature help | `filePath` + `line` + `character` |
| `rename` | Rename symbol across files | `filePath` + `line` + `character` + `newName` |
| `prepareRename` | Check whether rename is valid at a position | `filePath` + `line` + `character` |
| `foldingRange` | Get foldable regions in a file | `filePath` |
| `codeAction` | Get quick fixes/refactors | `filePath` + `line` + `character`, optional `endLine` / `endCharacter` |

The old `action` / `file` / `files` / `column` / `query` interface is no longer the primary API.

**Severity filtering**: For `diagnostics` and `workspaceDiagnostics`, use the `severity` parameter to filter results:
- `all` (default): Show all diagnostics
- `error`: Only errors
- `warning`: Errors and warnings
- `info`: Errors, warnings, and info
- `hint`: All including hints

**Workspace diagnostics**: The `workspaceDiagnostics` operation analyzes multiple files at once. Pass an array of file paths in `filePaths`. Each file is opened, analyzed by the appropriate LSP server, and diagnostics are aggregated into one response.

```bash
# Example tool calls
lsp operation=goToDefinition filePath=src/index.ts line=12 character=7
lsp operation=workspaceDiagnostics filePaths=["src/index.ts","src/utils.ts"] severity=error
```

Example questions the LLM can answer using this tool:
- "Where is `handleSessionStart` defined in `lsp-hook.ts`?"
- "Find all references to `getManager`"
- "What type does `getDefinition` return?"
- "List symbols in `lsp-core.ts`"
- "Check all TypeScript files in src/ for errors"
- "Get only errors from `index.ts`"
- "Rename `oldFunction` to `newFunction`"
- "What quick fixes are available at line 10?"

## Settings

Use `/lsp` to configure the auto diagnostics hook:
- Mode: default at agent end; can run after each edit/write or be disabled
- Scope: session-only or global (`~/.pi/agent/settings.json`)

To disable auto diagnostics, choose "Disabled" in `/lsp` or set in `~/.pi/agent/settings.json`:
```json
{
  "lsp": {
    "hookMode": "disabled"
  }
}
```
Other values: `"agent_end"` (default) and `"edit_write"`.

Agent-end mode analyzes files touched during the full agent response (after all tool calls complete) and posts a diagnostics message only once. Disabling the hook does not disable the `/lsp` tool.

### Server configuration

`lsp-pi` also supports detailed per-server configuration in Pi settings files:

- Global: `~/.pi/agent/settings.json`
- Project: `.pi/settings.json`

Project settings override global settings.

Supported per-server keys include:

- `disabled`
- `command`
- `args`
- `env`
- `rootMarkers`
- `initializationOptions`
- `workspaceConfiguration`

## lsp-pi Configuration

This document describes the configurable LSP server settings supported by `lsp-pi`.

## Settings Files

`lsp-pi` reads settings from two standard Pi locations:

- Global: `~/.pi/agent/settings.json`
- Project: `.pi/settings.json`

Project settings override global settings.

## Settings Shape

Put all `lsp-pi` settings under the top-level `lsp` key.

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "typescript": {
        "command": "typescript-language-server",
        "args": ["--stdio"],
        "env": {
          "TSS_LOG": "-level verbose -file /tmp/tsserver.log"
        },
        "rootMarkers": ["package.json", "tsconfig.json"],
        "initializationOptions": {
          "preferences": {
            "includeCompletionsForModuleExports": true
          }
        },
        "workspaceConfiguration": {
          "typescript": {
            "format": {
              "semicolons": "remove"
            }
          }
        }
      }
    }
  }
}
```

## Supported Keys

Each entry under `lsp.servers.<serverId>` supports these keys:

- `disabled: boolean`
  - Disable this server entirely.
- `command: string`
  - Override the executable used to launch the language server.
- `args: string[]`
  - Override the argument list passed to the command.
  - If omitted, `lsp-pi` uses the server's built-in default arguments.
- `env: Record<string, string>`
  - Extra environment variables merged into the child process environment.
- `rootMarkers: string[]`
  - Override the file markers used for root detection.
  - When provided, these replace the built-in root detection markers for that server.
- `initializationOptions: object`
  - Sent as LSP `initialize.initializationOptions`.
- `workspaceConfiguration: object`
  - Returned for `workspace/configuration` requests and sent once via `workspace/didChangeConfiguration` after initialization.

## Supported Server IDs

Current built-in server IDs:

- `dart`
- `typescript`
- `vue`
- `svelte`
- `pyright`
- `gopls`
- `kotlin`
- `swift`
- `rust-analyzer`

These IDs match the internal server registry, not always the upstream executable name.

## Merge Rules

Global and project settings are merged with these rules:

- Scalars such as `command` and `disabled` are overridden by project settings.
- Arrays such as `args` and `rootMarkers` are replaced by project settings.
- Objects such as `env`, `initializationOptions`, and `workspaceConfiguration` are deep-merged.

Example:

- Global sets `env.GLOBAL_FLAG=1`
- Project sets `env.PROJECT_FLAG=1`
- Effective config contains both flags

## Runtime Behavior

### Startup

When `lsp-pi` starts a server, it:

1. Resolves the effective server settings from global + project settings.
2. Uses the effective `rootMarkers` if provided.
3. Uses the effective `command` / `args` / `env` if provided.
4. Sends `initializationOptions` in the `initialize` request.
5. Exposes `workspaceConfiguration` through `workspace/configuration` and `workspace/didChangeConfiguration`.

### File changes

When Pi performs `write` or `edit`:

- `lsp-pi` sends `workspace/didChangeWatchedFiles` to active matching servers.
- If the changed file is a project config file or LSP settings file, active servers for affected roots are restarted.

This lets servers reload settings such as `tsconfig.json`, `pyproject.toml`, `Cargo.toml`, or `.pi/settings.json` without requiring a full Pi restart.

## Examples

### Use a custom Pyright binary

```json
{
  "lsp": {
    "servers": {
      "pyright": {
        "command": "/opt/pyright/bin/pyright-langserver",
        "args": ["--stdio"]
      }
    }
  }
}
```

### Disable Rust temporarily

```json
{
  "lsp": {
    "servers": {
      "rust-analyzer": {
        "disabled": true
      }
    }
  }
}
```

### Add custom TypeScript workspace configuration

```json
{
  "lsp": {
    "servers": {
      "typescript": {
        "workspaceConfiguration": {
          "typescript": {
            "format": {
              "insertSpaceAfterCommaDelimiter": true,
              "semicolons": "remove"
            }
          }
        }
      }
    }
  }
}
```

### Override root detection in a monorepo

```json
{
  "lsp": {
    "servers": {
      "typescript": {
        "rootMarkers": ["pnpm-workspace.yaml", "tsconfig.base.json"]
      }
    }
  }
}
```

## Notes and Limitations

- Settings only affect servers started by `lsp-pi`.
- Project-local `.pi/settings.json` is the recommended place for repository-specific overrides.
- Global settings are best for personal executable paths or personal defaults.
- Invalid or malformed LSP settings are ignored rather than crashing the extension.
- Some upstream servers may ignore parts of `initializationOptions` or `workspaceConfiguration`; support depends on the server implementation.


## File Structure

| File | Purpose |
|------|---------|
| `lsp.ts` | Hook extension (auto-diagnostics; default at agent end) |
| `lsp-tool.ts` | Tool extension (on-demand LSP queries) |
| `lsp-tool-formatters.ts` | Claude-style formatter helpers for tool output |
| `lsp-tool-schemas.ts` | Zod schemas for Claude-style tool input |
| `lsp-tool-symbol-context.ts` | Symbol extraction helper for tool call rendering |
| `lsp-settings.ts` | Global/project LSP server settings loader and merge logic |
| `lsp-core.ts` | LSPManager class, server configs, singleton manager |
| `CONFIGURATION.md` | Detailed server configuration reference |
| `package.json` | Declares both extensions via "pi" field |


## Testing

```bash
# Unit tests (root detection, configuration)
npm test

# Tool tests
npm run test:tool

# Integration tests (spawns real language servers)
npm run test:integration

# Run rust-analyzer tests (slow, disabled by default)
RUST_LSP_TEST=1 npm run test:integration
```

## License

MIT
