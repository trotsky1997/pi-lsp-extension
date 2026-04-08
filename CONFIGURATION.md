# lsp-pi Configuration

`lsp-pi` is configured entirely through Pi settings files.

## Settings files

- Global: `~/.pi/agent/settings.json`
- Project: `.pi/settings.json`

Project settings override global settings.

## Settings shape

```json
{
  "lsp": {
    "enabled": true,
    "hookMode": "agent_end",
    "python": {
      "provider": "basedpyright"
    },
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
  },
  "formatter": {
    "enabled": true,
    "hookMode": "write",
    "formatters": {
      "biome": {
        "disabled": false
      },
      "prettier": {
        "disabled": true
      },
      "ruff": {
        "command": "ruff",
        "args": ["format", "src/app.py"]
      }
    }
  }
}
```

## Top-level `lsp` keys

- `enabled: boolean`
- `hookMode: "edit_write" | "agent_end" | "disabled"`
- `python.provider: "pyright" | "basedpyright" | "ty"`
- `servers: Record<string, LSPServerSettings>`

`lsp.python.provider` selects which Python server handles `.py` and `.pyi` files.

## Per-server keys

Each entry under `lsp.servers.<serverId>` supports:

- `disabled: boolean`
- `command: string`
- `args: string[]`
- `env: Record<string, string>`
- `rootMarkers: string[]`
- `initializationOptions: object`
- `workspaceConfiguration: object`

## Top-level `formatter` keys

- `enabled: boolean`
- `hookMode: "write" | "edit_write" | "disabled"`
- `formatters: Record<string, FormatterSettings>`

## Per-formatter keys

Each entry under `formatter.formatters.<formatterId>` supports:

- `disabled: boolean`
- `command: string`
- `args: string[]`
- `env: Record<string, string>`
- `environment: Record<string, string>`
- `extensions: string[]`
- `rootMarkers: string[]`

`environment` is accepted for OpenCode-style compatibility. If both `env` and `environment` are present, both are merged.

## Built-in server IDs

- `astro`
- `bash`
- `clangd`
- `csharp`
- `clojure-lsp`
- `dart`
- `deno`
- `elixir-ls`
- `eslint`
- `fsharp`
- `gleam`
- `gopls`
- `hls`
- `jdtls`
- `julials`
- `kotlin`
- `lua-ls`
- `nixd`
- `ocaml-lsp`
- `oxlint`
- `php`
- `prisma`
- `pyright`
- `basedpyright`
- `ty`
- `ruby-lsp`
- `rust-analyzer`
- `svelte`
- `swift`
- `terraform`
- `tinymist`
- `typescript`
- `vue`
- `yaml-ls`
- `zls`

## Built-in formatter IDs

- `air`
- `biome`
- `clang-format`
- `cljfmt`
- `dart`
- `dfmt`
- `gleam`
- `gofmt`
- `htmlbeautifier`
- `ktlint`
- `mix`
- `nixfmt`
- `ocamlformat`
- `ormolu`
- `pint`
- `prettier`
- `ruff`
- `rubocop`
- `rustfmt`
- `shfmt`
- `standardrb`
- `terraform`
- `uv`
- `zig`

## Merge rules

Global and project settings are merged with these rules:

- scalars such as `command`, `disabled`, `hookMode`, and `provider` are overridden by project settings
- arrays such as `args`, `rootMarkers`, and `extensions` are replaced by project settings
- objects such as `env`, `environment`, `initializationOptions`, and `workspaceConfiguration` are deep-merged

## Examples

### Select Ty for Python

```json
{
  "lsp": {
    "python": {
      "provider": "ty"
    }
  }
}
```

### Override the BasedPyright binary

```json
{
  "lsp": {
    "python": {
      "provider": "basedpyright"
    },
    "servers": {
      "basedpyright": {
        "command": "/opt/basedpyright/bin/basedpyright-langserver",
        "args": ["--stdio"]
      }
    }
  }
}
```

### Prefer Biome and disable Prettier

```json
{
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "biome": {
        "disabled": false
      },
      "prettier": {
        "disabled": true
      }
    }
  }
}
```

### Use a custom Ruff command

```json
{
  "formatter": {
    "formatters": {
      "ruff": {
        "command": "/opt/ruff/bin/ruff",
        "args": ["format", "src/app.py"]
      }
    }
  }
}
```

### Override TypeScript root detection in a monorepo

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

## Notes

- `/lsp` is a status/help command only; it does not write configuration.
- `/lsp doctor` writes a local report to `.pi/lsp-doctor.md` in the current workspace.
- Invalid or malformed settings are ignored instead of crashing the extension.
- `lsp-pi` does not auto-install language servers or formatters.
- Formatter execution is best-effort and only runs when a matching configured or built-in binary is available.
