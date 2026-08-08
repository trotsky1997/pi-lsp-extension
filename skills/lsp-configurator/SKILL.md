---
name: lsp-configurator
description: Configure `lsp-pi` for a project or user environment. Use this whenever the user wants help setting up Pi LSP, formatters, analyzers, debug adapters (DAP), Python provider selection, or `.pi/settings.json` / `~/.pi/agent/settings.json` / `dap.json` entries for code intelligence and debugging. Also use it when the user asks which `lsp-pi` servers, formatters, analyzers, or debug adapters to enable for a repo.
---

# LSP Configurator

Help the user configure `lsp-pi` through Pi settings files. This skill is interactive: inspect the repo, infer likely languages and tools, ask a short round of focused questions, then write or patch the appropriate settings file.

## Goal

Produce a working `lsp-pi` configuration for the user's stack across these four domains:

- `lsp` for language servers
- `formatter` for format-on-write tools
- `analyzer` for non-LSP diagnostics such as `semgrep`, `ruff-check`, `golangci-lint`, `markdownlint`, `lychee`, `shellcheck`, `hadolint`, `slopgrep`, `sloppylint`, and `karpeslop`
- `debug` for DAP (Debug Adapter Protocol) adapters — `lldb-dap`, `gdb`, `debugpy`, `dlv`, `codelldb`, `rdbg`, etc. Configured via `dap.json` (not `.pi/settings.json`)

Because `lsp-pi` is config-first, do not route configuration through `/lsp`. `/lsp` is status/help only.

## Read First

Before proposing changes:

1. Read these settings files if they exist:
   - project: `.pi/settings.json`
   - global: `~/.pi/agent/settings.json`
   - DAP adapter config: `~/.pi/dap.json` or `.pi/dap.json` (debug adapters)
2. Inspect the workspace for language indicators and likely tooling:
   - `package.json`, `tsconfig.json`, `jsconfig.json`
   - `pyproject.toml`, `requirements.txt`, `ty.toml`
   - `go.mod`, `go.work`
   - `Cargo.toml`
   - `Dockerfile`
   - `mix.exs`, `gleam.toml`, `Package.swift`, `terraform.tf`, `main.tf`
   - Markdown-heavy docs such as `README.md`, `docs/**/*.md`
3. Read `references/lsp-pi-config.md` from this skill directory for the current built-in IDs and config patterns.

## Interview Flow

Keep the question round short. Ask only what the repo cannot answer.

### Always confirm

- Should config be written to the project file `.pi/settings.json` or the global file `~/.pi/agent/settings.json`?
- Does the user want diagnostics at `agent_end`, on `edit_write`, or disabled?

### Ask only when relevant

- If Python is present: which provider should handle Python, `pyright`, `basedpyright`, or `ty`?
- If multiple formatter options fit a language, which one should be preferred?
- If analyzer tools are relevant, should they run on `agent_end`, on write, or be disabled?
- If debugging is relevant: which DAP adapter should be the default for the primary language? (see Mapping Heuristics below)
- If the repo clearly indicates a preferred tool already, propose that first instead of asking a vague open-ended question.

## Mapping Heuristics

Use the repo layout to propose a sensible default.

### JavaScript / TypeScript

If `package.json` or TS config files exist, usually propose:

- LSP: `typescript`
- Formatter: `biome` if `biome.json` / `biome.jsonc` exists, otherwise `prettier`
- Analyzer: `semgrep` by default, optionally `karpeslop` for TS/JS AI-slop detection and `markdownlint` for Markdown-heavy repos

If `deno.json` or `deno.jsonc` exists, prefer `deno` over `typescript`.

### JSON / TOML / PowerShell

- If the repo has many `.json` / `.jsonc` files or schema-heavy config, propose LSP `json-ls`, formatter `prettier` or `biome`, and optionally analyzer `biome-lint` for Biome-based repos.
- If the repo has `.toml` files, propose LSP `taplo`, formatter `taplo`, and analyzer `taplo-check`.
- If the repo has `.ps1`, `.psm1`, or `.psd1` files, propose LSP `powershell` plus formatter/analyzer `psscriptanalyzer`.

### Python

If Python files or `pyproject.toml` exist, propose:

- LSP: `lsp.python.provider`
- Formatter: `ruff` if available, otherwise leave formatter unset unless the user asks
- Analyzer: `ruff-check`, optionally `semgrep`, and optionally `sloppylint` for Python AI-code anti-pattern detection

Provider suggestions:

- `basedpyright` for stronger Pyright-style diagnostics
- `ty` if the repo already uses `ty.toml` or the user prefers Ty
- `pyright` for conservative compatibility

### Go

If `go.mod` or `go.work` exists, propose:

- LSP: `gopls`
- Formatter: `gofmt`
- Analyzer: `golangci-lint`, optionally `semgrep`

### Rust

If `Cargo.toml` exists, propose:

- LSP: `rust-analyzer`
- Formatter: `rustfmt`
- Analyzer: `semgrep` only if the user wants cross-language scanning

### Markdown-heavy repos

If many `.md` / `.mdx` files exist, propose:

- LSP: `markdown` via `markdown-oxide`
- Formatter: `rumdl`
- Analyzer: `markdownlint`, optionally `lychee` for broken-link checks, and optionally `slopgrep` for prose-quality / AI-writing-tell scanning

### LaTeX / academic writing

If `.tex` files are present, propose:

- LSP: `texlab`
- Analyzer: optionally `slopgrep` when the user wants prose / AI-writing-tell scanning in TeX content

### Shell / Docker / IaC

- Shell files: analyzer `shellcheck`, formatter `shfmt`
- `Dockerfile`: analyzer `hadolint`
- Terraform files: LSP `terraform`, formatter `terraform`

### Debug adapters (DAP)

The `debug` tool auto-selects an adapter by file extension when no `adapter`
parameter is passed. Override defaults only when the built-in command is wrong
(e.g. non-default Python version, or a custom adapter path).

Per-language defaults (from `dap/defaults.json`):

- C / C++ / Rust / Zig: `lldb-dap` (fallback: `gdb`, `codelldb`)
- Python: `debugpy` (`python -m debugpy.adapter`)
- Go: `dlv` (`dlv dap`)
- JavaScript / TypeScript: `js-debug-adapter`
- C# / F#: `netcoredbg`
- Ruby: `rdbg`
- Dart / Flutter: `dart-debug-adapter` / `flutter-debug-adapter`
- Kotlin: `kotlin-debug-adapter`
- PHP: `php-debug-adapter`
- Bash / Shell: `bash-debug-adapter`
- Elixir: `elixir-ls-debugger`

Common override: if the default `python` is Python 3.14+ (debugpy 1.8.x does
not support it), point `command` at a 3.12 binary:

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

DAP config files: `dap.json` / `.dap.json` / `dap.yaml` in `~/.pi/` (user)
or `.pi/` (project). Not in `.pi/settings.json`.

## Output Style

Before editing a settings file, summarize what you found in a compact form:

- detected languages / frameworks
- proposed LSP servers
- proposed formatters
- proposed analyzers
- proposed debug adapters (if relevant)
- target config file(s)

Then show the exact JSON fragment you plan to add or change.

## Apply Changes

After the user confirms:

1. Patch the chosen settings file (or `dap.json` for debug adapters).
2. Preserve unrelated existing settings.
3. Merge into existing `lsp`, `formatter`, and `analyzer` objects instead of overwriting them wholesale unless the file is empty.
4. For DAP overrides, write to `~/.pi/dap.json` or `.pi/dap.json` — never `.pi/settings.json`.
5. Prefer minimal config. Only add entries the user needs.

## Suggested Config Patterns

### Minimal TypeScript + Markdown project config

```json
{
  "lsp": {
    "hookMode": "agent_end"
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "prettier": {},
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

### Python project with BasedPyright + Ruff

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "python": {
      "provider": "basedpyright"
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "ruff": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "ruff-check": {}
    }
  }
}
```

## Verification

After writing config:

- tell the user which file was updated
- briefly list the enabled providers/tools/adapters
- recommend running `/lsp doctor`
- if binaries are not installed, say so explicitly and point the user to the install section in `lsp-pi/README.md`
- for debug adapters, remind the user that the adapter binary must be on PATH (no auto-install)

## Success Signals

The skill is done when:

- the correct settings file has been updated
- the resulting config matches the detected stack and user preferences
- the user knows where the config lives
- the user has a clear next verification step: `/lsp doctor`
