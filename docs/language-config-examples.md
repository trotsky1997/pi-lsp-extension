# Language Configuration Examples

This file gives two `.pi/settings.json` examples for each supported language or
language ecosystem.

- Minimal: enable the relevant language server with conservative hooks.
- Full strict: run diagnostics earlier and add available formatters/analyzers.

"Full strict" is literal type strictness only where the ecosystem supports a
strict type mode. For prose, markup, schemas, and shell scripts it means
stricter validation, linting, formatting, link checks, or prose checks.
Some strictness still belongs in native project files such as `tsconfig.json`,
`pyrightconfig.json`, `analysis_options.yaml`, `Cargo.toml`, or build files.

## Groups

- Typed languages: application and library ecosystems where strictness is often
  compiler-, type-, or build-driven
- Docs & markup: prose and document-oriented formats where strictness means
  formatting, linting, links, and document validation
- Infra languages: shells, schemas, and infrastructure tooling where strictness
  means validation, static checks, and reproducible formatting

## Typed Languages

This group also includes some dynamic-language ecosystems. In those cases,
"full strict" means the strictest realistic `lsp-pi` setup plus the usual
project-side compiler or linter settings.

### Astro

- Install: `npm i -g @astrojs/language-server typescript-language-server typescript prettier vscode-langservers-extracted`
- Strictness note: Astro strictness mostly comes from the TypeScript config used
  by the project.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "astro": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "astro": {},
      "typescript": {},
      "eslint": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "prettier": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### C / C++ / Objective-C

- Install: `brew install llvm`
- Strictness note: the real strictness comes from `compile_commands.json`,
  `compile_flags.txt`, and compiler flags such as `-Wall -Wextra -Wpedantic`
  and `-Werror`.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "clangd": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "clangd": {
        "args": ["--background-index", "--clang-tidy"]
      }
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "clang-format": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### C\#

- Install: `dotnet tool install --global csharp-ls`
- Strictness note: enable nullable reference types and warning policies in the
  project file, for example `Nullable=enable` and `TreatWarningsAsErrors=true`.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "csharp": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "csharp": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### Clojure

- Install: `brew install clojure-lsp` and `brew install cljfmt`
- Strictness note: Clojure strictness is project- and linter-driven rather than
  a built-in type-strict mode in `lsp-pi`.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "clojure-lsp": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "clojure-lsp": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "cljfmt": {}
    }
  }
}
```

### Dart / Flutter

- Install: use your Dart or Flutter toolchain so `dart language-server` and
  `dart format` are on `PATH`
- Strictness note: configure `analysis_options.yaml` with `strict-casts`,
  `strict-inference`, and `strict-raw-types`.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "dart": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "dart": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "dart": {}
    }
  }
}
```

### Deno

- Install: `brew install deno` or use the official installer so `deno` is on
  `PATH`
- Strictness note: put lint and TypeScript compiler options in `deno.json` or
  `deno.jsonc`.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "deno": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "deno": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### Elixir

- Install: `brew install elixir-ls`
- Strictness note: Elixir has optional type specs and Dialyzer workflows, but
  no global type-strict mode in `lsp-pi`.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "elixir-ls": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "elixir-ls": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "mix": {}
    }
  }
}
```

### F\#

- Install: `dotnet tool install --global fsautocomplete`
- Strictness note: F# strictness usually lives in project build settings and
  compiler warning policies.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "fsharp": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "fsharp": {}
    }
  }
}
```

### Gleam

- Install: `brew install gleam`
- Strictness note: Gleam is statically typed by default; full strictness is
  compiler- and project-driven.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "gleam": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "gleam": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "gleam": {}
    }
  }
}
```

### Go

- Install: `go install golang.org/x/tools/gopls@latest` and `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest`
- Strictness note: Go strictness is mostly `go test`, `go vet`, `gopls`, and
  project linter configuration.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "gopls": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "gopls": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "gofmt": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "golangci-lint": {},
      "semgrep": {}
    }
  }
}
```

### Haskell

- Install: `brew install haskell-language-server ormolu`
- Strictness note: Haskell strictness lives in GHC options and package config,
  for example warning flags and warnings-as-errors.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "hls": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "hls": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "ormolu": {}
    }
  }
}
```

### Java

- Install: `brew install jdtls`
- Strictness note: Java strictness is usually compiler, build-tool, nullness,
  and static-analysis configuration rather than a single LSP setting.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "jdtls": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "jdtls": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### Julia

- Install: provide a `julia-language-server` wrapper binary or install your
  usual Julia language-server setup
- Strictness note: Julia has optional type annotations but no global
  type-strict mode in `lsp-pi`.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "julials": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "julials": {}
    }
  }
}
```

### Kotlin

- Install: `brew install JetBrains/utils/kotlin-lsp ktlint`
- Strictness note: configure stricter compiler options in Gradle or Maven.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "kotlin": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "kotlin": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "ktlint": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### Lua

- Install: `brew install lua-language-server`
- Strictness note: configure `.luarc.json` or `.luarc.jsonc` for stricter
  diagnostics.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "lua-ls": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "lua-ls": {}
    }
  }
}
```

### OCaml

- Install: `brew install ocaml-lsp ocamlformat`
- Strictness note: OCaml is statically typed by default; additional strictness
  is compiler and Dune configuration.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "ocaml-lsp": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "ocaml-lsp": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "ocamlformat": {}
    }
  }
}
```

### PHP

- Install: `composer global require bmewburn/intelephense laravel/pint`
- Strictness note: the real strictness comes from `declare(strict_types=1);`
  and project-side static-analysis tooling.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "php": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "php": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "pint": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### Python

- Install: `npm i -g pyright basedpyright`, `uv tool install ty ruff`, and
  `pip install sloppylint`
- Strictness note: set `typeCheckingMode` in `pyrightconfig.json` or
  `[tool.pyright]` / `[tool.basedpyright]` in `pyproject.toml`.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "python": {
      "provider": "pyright"
    },
    "servers": {
      "pyright": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "python": {
      "provider": "basedpyright"
    },
    "servers": {
      "basedpyright": {}
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
      "ruff-check": {},
      "sloppylint": {},
      "semgrep": {}
    }
  }
}
```

Project-side strict example:

```json
{
  "typeCheckingMode": "strict"
}
```

### Ruby

- Install: `gem install ruby-lsp standard rubocop`
- Strictness note: Ruby type strictness requires project tooling outside the
  built-in `lsp-pi` registry; this example focuses on LSP, formatting, and
  general scanning.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "ruby-lsp": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "ruby-lsp": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "standardrb": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### Rust

- Install: `rustup component add rust-analyzer rustfmt clippy`
- Strictness note: Rust is statically typed by default. Add project-side
  compiler and Clippy rules for additional strictness.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "rust-analyzer": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "rust-analyzer": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "rustfmt": {}
    }
  }
}
```

### Svelte

- Install: `npm i -g svelte-language-server typescript-language-server typescript prettier vscode-langservers-extracted`
- Strictness note: Svelte strictness mostly comes from the TypeScript config
  used by the project.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "svelte": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "svelte": {},
      "typescript": {},
      "eslint": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "prettier": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### Swift

- Install: `xcode-select --install` so `sourcekit-lsp` is available via Xcode
  command-line tools
- Strictness note: Swift strictness is compiler- and package-configuration
  driven.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "swift": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "swift": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### TypeScript / JavaScript

- Install: `npm i -g typescript-language-server typescript @biomejs/biome vscode-langservers-extracted @oxc/language-server karpeslop`
- Strictness note: use a strict `tsconfig.json` or `jsconfig.json` for real
  type strictness.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "typescript": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "typescript": {},
      "eslint": {},
      "oxlint": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "biome": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {},
      "karpeslop": {}
    }
  }
}
```

Project-side strict example:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true
  }
}
```

### Vue

- Install: `npm i -g @vue/language-server typescript-language-server typescript prettier vscode-langservers-extracted`
- Strictness note: Vue strictness mostly comes from the TypeScript config used
  by the project.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "vue": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "vue": {},
      "typescript": {},
      "eslint": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "prettier": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### Zig

- Install: `zvm i --zls latest` and ensure the Zig toolchain is installed
- Strictness note: Zig is statically typed by default; additional strictness is
  compiler- and project-check driven.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "zls": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "zls": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "zig": {}
    }
  }
}
```

## Docs & Markup

### Markdown / MDX

- Install: `cargo install --locked --git https://github.com/Feel-ix-343/markdown-oxide.git markdown-oxide`, `npm i -g rumdl markdownlint-cli`, `cargo install lychee`, `uv tool install git+https://github.com/trotsky1997/slopgrep.git`, `pip3 install thinkst-zippy`
- Strictness note: Markdown has no type system; strictness means formatting,
  Markdown linting, link checks, and prose or AI-text checks where useful.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "markdown": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "markdown": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "rumdl": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "markdownlint": {},
      "lychee": {},
      "slopgrep": {},
      "zippy": {}
    }
  }
}
```

### TeX / LaTeX / BibTeX

- Install: `cargo install texlab`, plus optional `uv tool install git+https://github.com/trotsky1997/slopgrep.git` and `pip3 install thinkst-zippy`
- Strictness note: LaTeX has no type-strict mode; strictness means build
  validation and prose-level checks.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "texlab": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "texlab": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "slopgrep": {},
      "zippy": {}
    }
  }
}
```

### Typst

- Install: `cargo install tinymist`
- Strictness note: Typst strictness is document-validation driven rather than a
  type-strict mode.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "tinymist": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "tinymist": {}
    }
  }
}
```

## Infra Languages

### Bash / Shell

- Install: `npm i -g bash-language-server` and `brew install shellcheck shfmt`
- Strictness note: shell has no type-strict mode; strictness means
  `shellcheck`, `shfmt`, and careful shell options inside scripts.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "bash": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "bash": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "shfmt": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "shellcheck": {},
      "semgrep": {}
    }
  }
}
```

### Nix

- Install: `brew install nixd nixfmt`
- Strictness note: Nix strictness is formatter, evaluator, and flake-check
  driven.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "nixd": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "nixd": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "nixfmt": {}
    }
  }
}
```

### Prisma

- Install: `npm i -g @prisma/language-server`
- Strictness note: Prisma strictness is schema-validation and migration-workflow
  driven.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "prisma": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "prisma": {}
    }
  }
}
```

### Terraform / HCL

- Install: `brew install terraform-ls`
- Strictness note: Terraform strictness is formatter, `terraform validate`,
  plan checks, and policy tooling.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "terraform": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "terraform": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "terraform": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```

### YAML

- Install: `npm i -g yaml-language-server prettier`
- Strictness note: YAML has no type system; strictness means schema validation,
  formatting, and rule-based scanning.

`minimal`

```json
{
  "lsp": {
    "hookMode": "agent_end",
    "servers": {
      "yaml-ls": {}
    }
  }
}
```

`full strict`

```json
{
  "lsp": {
    "hookMode": "edit_write",
    "servers": {
      "yaml-ls": {}
    }
  },
  "formatter": {
    "hookMode": "write",
    "formatters": {
      "prettier": {}
    }
  },
  "analyzer": {
    "hookMode": "agent_end",
    "tools": {
      "semgrep": {}
    }
  }
}
```
