# lsp-pi Quick Reference

Use this reference when generating or patching Pi settings for `lsp-pi`.

## Settings files

- Project: `.pi/settings.json`
- Global: `~/.pi/agent/settings.json`

## Top-level domains

### `lsp`

Common keys:

- `enabled: boolean`
- `hookMode: "edit_write" | "agent_end" | "disabled"`
- `python.provider: "pyright" | "basedpyright" | "ty"`
- `servers.<id>` overrides

### `formatter`

Common keys:

- `enabled: boolean`
- `hookMode: "write" | "edit_write" | "disabled"`
- `formatters.<id>` overrides

### `analyzer`

Common keys:

- `enabled: boolean`
- `hookMode: "write" | "edit_write" | "agent_end" | "disabled"`
- `tools.<id>` or `analyzers.<id>` overrides

## Built-in LSP IDs

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

- `semgrep`
- `ruff-check`
- `golangci-lint`
- `karpeslop`
- `markdownlint`
- `shellcheck`
- `hadolint`
- `slopgrep`
- `sloppylint`

## Good default mappings

- TypeScript / JavaScript: `typescript`, formatter `biome` or `prettier`, analyzer `semgrep`
- TypeScript / JavaScript AI-slop scans: optionally add analyzer `karpeslop`
- Deno: `deno`
- Python: provider `basedpyright` or `ty`, formatter `ruff`, analyzer `ruff-check`
- Python AI-code-quality scans: optionally add analyzer `sloppylint`
- Go: `gopls`, formatter `gofmt`, analyzer `golangci-lint`
- Rust: `rust-analyzer`, formatter `rustfmt`
- Markdown: `markdown`, formatter `rumdl`, analyzer `markdownlint`
- Markdown / prose-heavy docs: optionally add analyzer `slopgrep`
- LaTeX: `texlab`, and optionally analyzer `slopgrep`
- Shell: formatter `shfmt`, analyzer `shellcheck`
- Dockerfile: analyzer `hadolint`
- Terraform: `terraform`, formatter `terraform`

## Override shape examples

### LSP server override

```json
{
  "lsp": {
    "servers": {
      "typescript": {
        "command": "typescript-language-server",
        "args": ["--stdio"]
      }
    }
  }
}
```

### Formatter override

```json
{
  "formatter": {
    "formatters": {
      "prettier": {
        "disabled": true
      }
    }
  }
}
```

### Analyzer override

```json
{
  "analyzer": {
    "tools": {
      "semgrep": {
        "command": "semgrep",
        "args": ["scan", "--json", "--quiet", "--config=auto"]
      }
    }
  }
}
```
