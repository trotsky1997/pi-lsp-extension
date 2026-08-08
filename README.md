# lsp-pi

Config-first code intelligence for `pi-coding-agent`.

`lsp-pi` combines four layers:

- `lsp` for language servers and editor-style code intelligence
- `formatter` for format-on-write tools
- `analyzer` for non-LSP diagnostics such as `semgrep`, `ruff-check`, `shellcheck`, and `lychee`
- `debug` for driving a real debugger (lldb-dap, gdb, dlv, debugpy, …) via DAP — launch, breakpoints, stepping, variable/memory inspection

It also ships a reusable setup skill at `skills/lsp-configurator/` for interactive configuration.

## What it gives you

- automatic diagnostics after writes/edits or at agent end
- on-demand `lsp` tool operations like definition, references, hover, rename, diagnostics, and code actions
- config-first behavior through `.pi/settings.json` or `~/.pi/agent/settings.json`
- built-in registries for many LSP servers, formatters, and analyzers
- `/lsp` status output and `/lsp doctor` workspace diagnostics
- bundled `lsp-configurator` skill for guided setup
- **`debug` tool** — drives a real debugger (lldb-dap, gdb, dlv, debugpy, codelldb, rdbg, …) via the Debug Adapter Protocol. Launch/attach, set breakpoints, step, inspect stack/variables/memory, evaluate expressions. Sessions persist across calls.
- **lsp → debug bridge** — `lsp setBreakpoint` resolves a symbol's definition via LSP, then sets a DAP breakpoint at the resolved location. One step: point at a function call, get a breakpoint at its definition.

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

Then install the binaries you actually want to use. `lsp-pi` does not auto-install language servers, formatters, analyzers, or debug adapters.

For debugging, just install the relevant debugger (`lldb-dap`, `gdb`, `python -m pip install debugpy`, `dlv`, etc.) — the `debug` tool is available out of the box, no config needed.

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
- `json-ls`
- `julials`
- `kotlin`
- `lua-ls`
- `markdown`
- `nixd`
- `ocaml-lsp`
- `oxlint`
- `php`
- `powershell`
- `prisma`
- `pyright`
- `basedpyright`
- `texlab`
- `taplo`
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
- `psscriptanalyzer`
- `rumdl`
- `ruff`
- `rubocop`
- `rustfmt`
- `shfmt`
- `standardrb`
- `taplo`
- `terraform`
- `uv`
- `zig`

Formatters are selected by file extension and binary availability. Project settings can disable or override any formatter.

### Analyzers

Built-in analyzer IDs:

- `biome-lint`
- `golangci-lint`
- `hadolint`
- `karpeslop`
- `lychee`
- `markdownlint`
- `psscriptanalyzer`
- `ruff-check`
- `semgrep`
- `slopgrep`
- `sloppylint`
- `shellcheck`
- `taplo-check`
- `zippy`

Analyzers are for extra diagnostics, not LSP features and not file rewriting.
Multiple analyzers can match and run for the same file.

## Install the tools you want

Typical install commands:

```bash
# Core JS / TS / Markdown / JSON / TOML
npm i -g typescript-language-server typescript prettier @biomejs/biome
npm i -g karpeslop
npm i -g rumdl markdownlint-cli
npm i -g vscode-langservers-extracted   # eslint, html, css, json
npm i -g yaml-language-server bash-language-server
uv tool install semgrep
uv tool install git+https://github.com/trotsky1997/slopgrep.git
uv tool install thinkst-zippy
cargo install lychee
cargo install --locked --git https://github.com/Feel-ix-343/markdown-oxide.git markdown-oxide
cargo install taplo-cli --locked

# PowerShell
# Install PowerShell 7+ plus a PowerShell Editor Services bundle.
# The VS Code PowerShell extension already bundles PowerShellEditorServices.
pwsh -NoLogo -NoProfile -Command "Install-Module PSScriptAnalyzer -Scope CurrentUser"

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
- `vscode-langservers-extracted` provides `vscode-json-language-server` for JSON / JSONC support.
- `biome-lint` can be used as an analyzer for JSON / JSONC repositories that already standardize on Biome.
- `markdown-oxide` is the built-in Markdown LSP and focuses on Markdown/PKM navigation features.
- `taplo` powers the built-in TOML LSP via `taplo lsp stdio`; use cargo or release binaries rather than the npm build if you need LSP support.
- `taplo` also powers the built-in TOML formatter hook via `taplo fmt`.
- `taplo-check` powers the built-in TOML analyzer hook via `taplo check`.
- PowerShell support uses PowerShell Editor Services under `pwsh`; if auto-discovery misses your bundle, set `PSES_BUNDLE_PATH`, point directly at `PSES_START_SCRIPT`, or override `lsp.servers.powershell.command` / `args`.
- `psscriptanalyzer` powers the built-in PowerShell analyzer and formatter hooks.
- `rumdl` is the preferred Markdown formatter (`rumdl fmt`).
- `semgrep` is an analyzer, not an LSP or formatter.
- `lychee` checks broken links in Markdown, HTML, and other doc-like text files.
- `slopgrep` is useful for prose-heavy repositories and AI-writing-tell scanning in Markdown, text, or LaTeX files.
- `zippy` classifies prose-oriented text, Markdown, and LaTeX as AI or human and `lsp-pi` renders it as a readable score label plus the raw zippy score; it is still a heuristic delta, not a calibrated probability or true percentage.
- `sloppylint` focuses on Python AI-code anti-patterns.
- `karpeslop` focuses on TypeScript / JavaScript / React AI-slop detection.
- Common analyzer-style tools bundled today are `semgrep`, `ruff check`, `golangci-lint run`, `markdownlint`, `lychee`, `shellcheck`, `hadolint`, `slopgrep`, `zippy`, `sloppylint`, and `karpeslop`.
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

For grouped per-language examples, including `minimal`, fuller strict
profiles, and recommended install commands, see
`docs/language-config-examples.md`.

## `debug` tool usage

The `debug` tool drives a real debugger via DAP (Debug Adapter Protocol). It is
a port of oh-my-pi's debug capability (https://github.com/can1357/oh-my-pi,
MIT, Can Boluk / Mario Zechner). The DAP engine lives in `dap/`; the tool entry
point is `debug.ts`.

**Actions** (28 total):

- **Launch/attach**: `launch`, `attach`, `terminate`, `sessions`
- **Breakpoints**: `set_breakpoint`, `remove_breakpoint`, `set_instruction_breakpoint`, `remove_instruction_breakpoint`, `data_breakpoint_info`, `set_data_breakpoint`, `remove_data_breakpoint`
- **Execution**: `continue`, `step_over`, `step_in`, `step_out`, `pause`
- **Inspection**: `stack_trace`, `threads`, `scopes`, `variables`, `disassemble`, `read_memory`, `loaded_sources`, `modules`, `output`
- **Evaluation**: `evaluate`, `write_memory`, `custom_request`

Sessions persist across tool calls — launch once, then step and inspect.

**Adapter configuration**: built-in adapters are in `dap/defaults.json`. Override via `dap.json` / `.dap.json` / `dap.yaml` in:
- `~/.pi/` (user)
- `.pi/` (project, walked up from cwd)

The adapter binary must be installed and on PATH. `lsp-pi` does not auto-install
debuggers.

### Built-in adapters

| Adapter | Languages | Command |
|---------|----------|---------|
| `gdb` | C, C++, Rust | `gdb -i dap` |
| `lldb-dap` | C, C++, ObjC, Swift, Rust, Zig | `lldb-dap` |
| `codelldb` | C, C++, Rust, Zig | `codelldb --port 0` |
| `debugpy` | Python | `python -m debugpy.adapter` |
| `dlv` | Go | `dlv dap` |
| `js-debug-adapter` | JavaScript, TypeScript | `js-debug-adapter` |
| `netcoredbg` | C#, F# | `netcoredbg --interpreter=vscode` |
| `rdbg` | Ruby | `rdbg --open --command --` |
| `dart-debug-adapter` | Dart | `dart debug_adapter` |
| `flutter-debug-adapter` | Dart (Flutter) | `dart debug_adapter --flutter-sdk-path` |
| `kotlin-debug-adapter` | Kotlin | `kotlin-debug-adapter` |
| `php-debug-adapter` | PHP | `php-debug-adapter` |
| `bash-debug-adapter` | Bash, Shell | `bash-debug-adapter` |
| `elixir-ls-debugger` | Elixir | `elixir-ls-debugger` |

### Example: debugging a segfault

```
debug action=launch program=./myapp adapter=lldb-dap
debug action=set_breakpoint file=src/main.rs line=42
debug action=continue
debug action=stack_trace
debug action=variables
debug action=evaluate expression=*ptr
debug action=terminate
```

### Example: debugging Python

```
debug action=launch program=./script.py adapter=debugpy
debug action=set_breakpoint file=script.py line=12
debug action=continue
debug action=scopes
debug action=variables
debug action=evaluate expression=x
debug action=terminate
```

### Example: lsp → debug bridge (setBreakpoint)

The `lsp` tool has a `setBreakpoint` operation that bridges LSP and DAP:
it resolves a symbol's definition via `goToDefinition`, then sets a DAP
breakpoint at the resolved location. Requires an active debug session.

```
debug action=launch program=./app.py adapter=debugpy
lsp  operation=setBreakpoint filePath=./app.py line=20 character=5
debug action=continue
debug action=stack_trace
debug action=terminate
```

This sets a breakpoint at the definition of the symbol under the cursor —
useful when you know *where you're calling from* but not *where it's defined*.
For plain line breakpoints, use `debug set_breakpoint` directly.

### Example: attaching to a running process

```
debug action=attach pid=12345 adapter=gdb
debug action=threads
debug action=stack_trace
debug action=variables
debug action=terminate
```

### Adapter override (non-default Python)

If the default `python` command points to an incompatible version (e.g.
debugpy 1.8.x does not support Python 3.14+), override it in `dap.json`:

```json
{
  "adapters": {
    "debugpy": {
      "command": "python3.12",
      "args": ["-m", "debugpy.adapter"],
      "languages": ["python"],
      "fileTypes": [".py"],
      "launchDefaults": { "request": "launch", "stopOnEntry": true }
    }
  }
}
```

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
