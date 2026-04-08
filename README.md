# lsp-pi

Language-server and format-on-write integration for `pi-coding-agent`.

## Highlights

- Automatic diagnostics hook after writes/edits or at agent end
- On-demand `lsp` tool for definition, references, hover, rename, diagnostics, and more
- Config-first behavior via `~/.pi/agent/settings.json` or `.pi/settings.json`
- Broad built-in registry inspired by OpenCode-style LSP and formatter coverage
- Optional formatter execution after `write` or `edit`

## Built-in LSP servers

`lsp-pi` ships built-in configs for these server IDs:

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

Python uses a selector model: `lsp.python.provider` chooses `pyright`, `basedpyright`, or `ty` for `.py` and `.pyi` files.

## Built-in formatters

`lsp-pi` also includes a formatter registry with these IDs:

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

Formatters are selected by file extension and availability. Project settings can disable or override any formatter.

## Installation

```bash
pi install npm:lsp-pi
```

Install the language servers and formatters you actually want to use. `lsp-pi` does not auto-install them.

Examples:

```bash
# TypeScript / JavaScript
npm i -g typescript-language-server typescript prettier @biomejs/biome

# Vue / Svelte / Astro
npm i -g @vue/language-server svelte-language-server @astrojs/language-server

# Python
npm i -g pyright basedpyright
uv tool install ty ruff

# Go / Rust
go install golang.org/x/tools/gopls@latest
rustup component add rust-analyzer rustfmt

# Shell / Terraform / YAML
npm i -g bash-language-server yaml-language-server
brew install shfmt terraform-ls
```

## Commands

### `/lsp`

`/lsp` is now a status/help command only.

It shows:

- current LSP hook mode
- current Python provider
- current formatter hook mode
- global and project config paths
- currently active server IDs

Configuration is not edited through the TUI.

### `/lsp doctor`

`/lsp doctor` writes a workspace-local diagnostic report to `.pi/lsp-doctor.md`.

The report includes:

- effective LSP and formatter settings
- configured overrides
- candidate servers and formatters for detected files
- LSP response status and diagnostic previews for sampled files

The command only tells the user the report path; it does not inject the report back into the agent context.

## Tool usage

The bundled `lsp` tool supports the Claude-style `operation` API.

Common operations:

- `goToDefinition`
- `findReferences`
- `hover`
- `documentHighlight`
- `documentSymbol`
- `workspaceSymbol`
- `goToImplementation`
- `typeDefinition`
- `prepareCallHierarchy`
- `incomingCalls`
- `outgoingCalls`
- `diagnostics`
- `workspaceDiagnostics`
- `signatureHelp`
- `rename`
- `prepareRename`
- `foldingRange`
- `codeAction`

Examples:

```bash
lsp operation=goToDefinition filePath=src/index.ts line=12 character=7
lsp operation=workspaceDiagnostics filePaths=['src/index.ts','src/util.ts'] severity=error
```

## Configuration

Use standard Pi settings files:

- global: `~/.pi/agent/settings.json`
- project: `.pi/settings.json`

Project settings override global settings.

See `CONFIGURATION.md` for the full schema.

### Example

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "python": {
      "provider": "basedpyright"
    },
    "servers": {
      "typescript": {
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

## Runtime behavior

### Diagnostics hook

`lsp.hookMode` supports:

- `edit_write`
- `agent_end`
- `disabled`

### Formatter hook

`formatter.hookMode` supports:

- `write`
- `edit_write`
- `disabled`

When formatting is enabled, `lsp-pi` runs the first matching available formatter after a `write` or `edit` event, then refreshes LSP state for that file.

## Testing

```bash
npm test
npm run test:tool
npm run test:integration
```
