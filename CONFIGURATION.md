# lsp-pi Configuration

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
