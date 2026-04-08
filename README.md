# lsp-pi

Config-first code intelligence for `pi-coding-agent`.

`lsp-pi` combines three layers:

- `lsp` for language servers and editor-style code intelligence
- `formatter` for format-on-write tools
- `analyzer` for non-LSP diagnostics such as `semgrep`, `ruff-check`, and `shellcheck`

It also ships a reusable setup skill at `skills/lsp-configurator/` for interactive configuration.

## What it gives you

- automatic diagnostics after writes/edits or at agent end
- on-demand `lsp` tool operations like definition, references, hover, rename, diagnostics, and code actions
- config-first behavior through `.pi/settings.json` or `~/.pi/agent/settings.json`
- built-in registries for many LSP servers, formatters, and analyzers
- `/lsp` status output and `/lsp doctor` workspace diagnostics
- bundled `lsp-configurator` skill for guided setup

## Quick start

Install the package:

```bash
pi install https://github.com/trotsky1997/pi-lsp-extension
```

To pin a ref or tag, use Pi's git package syntax:

```bash
pi install git:github.com/trotsky1997/pi-lsp-extension@main
```

Create a project config:

```json
{
  "lsp": {
    "hookMode": "agent_end"
  },
  "formatter": {
    "hookMode": "write"
  },
  "analyzer": {
    "hookMode": "agent_end"
  }
}
```

Then install the binaries you actually want to use. `lsp-pi` does not auto-install language servers, formatters, or analyzers.

## Bundled skill

This package ships `skills/lsp-configurator/`.

Use `lsp-configurator` when you want Pi to:

- inspect a repo and infer likely languages/tooling
- choose sensible `lsp`, `formatter`, and `analyzer` defaults
- help select the Python provider
- write or patch `.pi/settings.json` or `~/.pi/agent/settings.json`

After it writes config, verify with `/lsp doctor`.

## Built-in registries

### LSP servers

Built-in LSP server IDs:

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

Python uses a provider selector. `lsp.python.provider` chooses `pyright`, `basedpyright`, or `ty` for `.py` and `.pyi` files.

### Formatters

Built-in formatter IDs:

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

Formatters are selected by file extension and binary availability. Project settings can disable or override any formatter.

### Analyzers

Built-in analyzer IDs:

- `golangci-lint`
- `hadolint`
- `karpeslop`
- `markdownlint`
- `ruff-check`
- `semgrep`
- `slopgrep`
- `sloppylint`
- `shellcheck`

Analyzers are for extra diagnostics, not LSP features and not file rewriting.
Multiple analyzers can match and run for the same file.

## Install the tools you want

Typical install commands:

```bash
# Core JS / TS / Markdown
npm i -g typescript-language-server typescript prettier @biomejs/biome
npm i -g karpeslop
npm i -g rumdl markdownlint-cli
npm i -g vscode-langservers-extracted   # eslint, html, css, json
npm i -g yaml-language-server bash-language-server
uv tool install semgrep
uv tool install git+https://github.com/trotsky1997/slopgrep.git

# Vue / Svelte / Astro / Prisma
npm i -g @vue/language-server svelte-language-server @astrojs/language-server
npm i -g @prisma/language-server

# Python
npm i -g pyright basedpyright
uv tool install ty ruff
pip install sloppylint

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

# LaTeX / BibTeX
cargo install texlab

# C# / F#
dotnet tool install --global csharp-ls
dotnet tool install --global fsautocomplete

# Clojure / Elixir / Lua / OCaml / Haskell / Julia
brew install clojure-lsp elixir-ls lua-language-server ocaml-lsp haskell-language-server
# Julia LS depends on your Julia setup; install LanguageServer.jl or provide a julia-language-server wrapper binary

# PHP / Ruby
composer global require bmewburn/intelephense laravel/pint
gem install htmlbeautifier standard rubocop

# Optional / project-specific
npm i -g @oxc/language-server
npm i -g intelephense
brew install zls ocamlformat ormolu cljfmt
```

Notes:

- `sourcekit-lsp`, `dart format`, `mix format`, `gofmt`, and `rustfmt` often come from their main toolchains.
- `rumdl` provides both the Markdown LSP (`rumdl server`) and formatter (`rumdl fmt`).
- `semgrep` is an analyzer, not an LSP or formatter.
- `slopgrep` is useful for prose-heavy repositories and AI-writing-tell scanning in Markdown, text, or LaTeX files.
- `sloppylint` focuses on Python AI-code anti-patterns.
- `karpeslop` focuses on TypeScript / JavaScript / React AI-slop detection.
- Common analyzer-style tools bundled today are `semgrep`, `ruff check`, `golangci-lint run`, `markdownlint`, `shellcheck`, `hadolint`, `slopgrep`, `sloppylint`, and `karpeslop`.
- Package names vary by OS and package manager; the important part is that the expected executable is on `PATH`.

## Commands

### `/lsp`

`/lsp` is a status/help command.

It shows:

- current LSP hook mode
- current Python provider
- current formatter hook mode
- current analyzer hook mode
- global and project config paths
- active server IDs

It does not edit configuration.

### `/lsp doctor`

`/lsp doctor` writes a workspace-local report to `.pi/lsp-doctor.md`.

The report includes:

- effective LSP, formatter, and analyzer settings
- configured overrides
- candidate servers, formatters, and analyzers for sampled files
- LSP response status and diagnostic previews
- analyzer run status when applicable

The command only reports the path back to the user; it does not inject the report into agent context.

## `lsp` tool usage

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

## Configuration model

Use standard Pi settings files:

- project: `.pi/settings.json`
- global: `~/.pi/agent/settings.json`

Project settings override global settings.

See `CONFIGURATION.md` for the full schema and supported IDs.

### Example config

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
      "biome": {},
      "rumdl": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {},
      "markdownlint": {}
    }
  }
}
```

## Hook behavior

### LSP diagnostics

`lsp.hookMode` supports:

- `edit_write`
- `agent_end`
- `disabled`

### Formatter hook

`formatter.hookMode` supports:

- `write`
- `edit_write`
- `disabled`

When enabled, `lsp-pi` runs the first matching available formatter after a `write` or `edit`, then refreshes LSP state for that file.

### Analyzer hook

`analyzer.hookMode` supports:

- `write`
- `edit_write`
- `agent_end`
- `disabled`

Analyzer hooks run best-effort checks and report additional diagnostics-like findings.

## Testing

```bash
npm test
npm run test:tool
npm run test:integration
```
