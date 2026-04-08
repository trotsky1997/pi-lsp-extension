# lsp-pi

Language-server, formatter, and analyzer integration for `pi-coding-agent`.

## Highlights

- Automatic diagnostics hook after writes/edits or at agent end
- On-demand `lsp` tool for definition, references, hover, rename, diagnostics, and more
- Config-first behavior via `~/.pi/agent/settings.json` or `.pi/settings.json`
- Broad built-in registry inspired by OpenCode-style LSP and formatter coverage
- Optional formatter execution after `write` or `edit`
- Optional analyzer execution for extra diagnostics such as `semgrep`

## Built-in analyzers

`lsp-pi` includes an analyzer registry for non-LSP checkers. Current built-in analyzer IDs:

- `golangci-lint`
- `hadolint`
- `markdownlint`
- `ruff-check`
- `semgrep`
- `shellcheck`

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
- `markdown`
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
- `rumdl`
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

Install the language servers, formatters, and analyzers you actually want to use. `lsp-pi` does not auto-install them.

Typical install commands:

```bash
# Core JS / TS / Markdown
npm i -g typescript-language-server typescript prettier @biomejs/biome
npm i -g rumdl
npm i -g @semgrep/cli
npm i -g markdownlint-cli
npm i -g vscode-langservers-extracted   # eslint, html, css, json
npm i -g yaml-language-server bash-language-server

# Vue / Svelte / Astro / Prisma
npm i -g @vue/language-server svelte-language-server @astrojs/language-server
npm i -g @prisma/language-server

# Python
npm i -g pyright basedpyright
uv tool install ty ruff

# Go / Rust / Zig / Typst
go install golang.org/x/tools/gopls@latest
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
rustup component add rust-analyzer rustfmt
cargo install tinymist
zvm i --zls latest   # or install zls from https://zigtools.org/zls/install/

# C / C++ / Objective-C
brew install llvm    # clangd, clang-format

# JVM / Kotlin / Java
brew install JetBrains/utils/kotlin-lsp
brew install jdtls ktlint

# Swift / Dart / Terraform / Nix
xcode-select --install   # sourcekit-lsp via Xcode CLT on macOS
brew install terraform-ls shfmt shellcheck hadolint nixd nixfmt gleam
# Dart and Flutter usually provide dart language-server and dart format themselves

# C# / F#
dotnet tool install --global csharp-ls
dotnet tool install --global fsautocomplete

# Clojure / Elixir / Lua / OCaml / Haskell / Julia
brew install clojure-lsp elixir-ls lua-language-server ocaml-lsp haskell-language-server
# Julia LS depends on your Julia setup; install LanguageServer.jl or provide a julia-language-server wrapper binary

# PHP / Ruby
composer global require bmewburn/intelephense laravel/pint
gem install htmlbeautifier standard rubocop

# Formatters across ecosystems
brew install shfmt terraform zig llvm

# Language-specific formatters you may also want
brew install ocamlformat ormolu cljfmt
mix local.hex --force && mix archive.install hex phx_new --force   # mix format comes with Elixir/Mix
npm i -g prettier @biomejs/biome
uv tool install ruff
gem install htmlbeautifier standard rubocop

# Optional / project-specific
npm i -g @oxc/language-server
npm i -g intelephense
brew install zls
```

Notes:

- `eslint` support comes from `vscode-eslint-language-server`, which is provided by `vscode-langservers-extracted` in some setups; if you prefer, install the exact binary your environment provides.
- `php` support in `lsp-pi` expects the `intelephense` binary.
- `sourcekit-lsp`, `dart format`, `mix format`, `gofmt`, and `rustfmt` often ship with their main toolchains instead of separate packages.
- `rumdl` provides both the Markdown LSP (`rumdl server`) and formatter (`rumdl fmt`).
- `semgrep` acts as an analyzer, not an LSP or formatter.
- Common linter-style analyzers bundled today: `semgrep`, `ruff check`, `golangci-lint run`, `markdownlint`, `shellcheck`, and `hadolint`.
- Some ecosystem package names vary by OS package manager; the important part is that the expected executable is on `PATH`.

Minimal examples:

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
- current analyzer hook mode
- global and project config paths
- currently active server IDs

Configuration is not edited through the TUI.

### `/lsp doctor`

`/lsp doctor` writes a workspace-local diagnostic report to `.pi/lsp-doctor.md`.

The report includes:

- effective LSP, formatter, and analyzer settings
- configured overrides
- candidate servers, formatters, and analyzers for detected files
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
