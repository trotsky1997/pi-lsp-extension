# lsp-pi Configuration

`lsp-pi` is configured entirely through Pi settings files.

It supports three parallel domains:

- `lsp` for language servers
- `formatter` for format-on-write tools
- `analyzer` for non-LSP diagnostic tools such as `semgrep`

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
  },
  "analyzer": {
    "enabled": true,
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {
        "command": "semgrep",
        "args": ["scan", "--json", "--quiet", "--config=auto"],
        "extensions": [".js", ".ts", ".py"]
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

## Top-level `analyzer` keys

- `enabled: boolean`
- `hookMode: "write" | "edit_write" | "agent_end" | "disabled"`
- `tools: Record<string, AnalyzerSettings>`
- `analyzers: Record<string, AnalyzerSettings>`

`tools` and `analyzers` are both accepted; they resolve to the same internal registry.

## Per-formatter keys

Each entry under `formatter.formatters.<formatterId>` supports:

- `disabled: boolean`
- `command: string`
- `args: string[]`
- `env: Record<string, string>`
- `environment: Record<string, string>`
- `extensions: string[]`
- `rootMarkers: string[]`

## Per-analyzer keys

Each entry under `analyzer.tools.<analyzerId>` or `analyzer.analyzers.<analyzerId>` supports:

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
- `markdown`
- `nixd`
- `ocaml-lsp`
- `oxlint`
- `php`
- `prisma`
- `pyright`
- `basedpyright`
- `texlab`
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
- `rumdl`
- `ruff`
- `rubocop`
- `rustfmt`
- `shfmt`
- `standardrb`
- `terraform`
- `uv`
- `zig`

## Built-in analyzer IDs

- `golangci-lint`
- `hadolint`
- `markdownlint`
- `ruff-check`
- `semgrep`
- `slopgrep`
- `shellcheck`

## Merge rules

Global and project settings are merged with these rules:

- scalars such as `command`, `disabled`, `hookMode`, and `provider` are overridden by project settings
- arrays such as `args`, `rootMarkers`, and `extensions` are replaced by project settings
- objects such as `env`, `environment`, `initializationOptions`, and `workspaceConfiguration` are deep-merged
- analyzer object settings are merged with the same scalar/array/object rules

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

### Enable Semgrep analyzer at agent end

```json
{
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {
        "command": "semgrep",
        "args": ["scan", "--json", "--quiet", "--config=auto"]
      }
    }
  }
}
```

### Common analyzer-style tools supported out of the box

- `semgrep` for multi-language rule scanning
- `ruff-check` for Python
- `golangci-lint` for Go
- `markdownlint` for Markdown
- `shellcheck` for shell scripts
- `hadolint` for `Dockerfile`
- `slopgrep` for Markdown, prose-heavy text files, and LaTeX prose

## Notes

- `/lsp` is a status/help command only; it does not write configuration.
- `/lsp doctor` writes a local report to `.pi/lsp-doctor.md` in the current workspace.
- Invalid or malformed settings are ignored instead of crashing the extension.
- `lsp-pi` does not auto-install language servers or formatters.
- Formatter execution is best-effort and only runs when a matching configured or built-in binary is available.
