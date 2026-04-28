## 1. Standalone Project Setup

- [x] 1.1 Create the standalone project root for `openlsp-cli` outside the Pi extension package boundary.
- [x] 1.2 Add or normalize `package.json`, `tsconfig.json`, `bunfig.toml`, lockfile, and ignore rules for a Bun TypeScript CLI project.
- [x] 1.3 Define package scripts for development, typechecking, tests, and executable build output.
- [x] 1.4 Add a CLI executable entry in package metadata.
- [x] 1.5 Update the README so installation, commands, config, server mode, binary requirements, and validation are documented as standalone project behavior.

## 2. Source and Asset Extraction

- [x] 2.1 Copy the existing CLI source and tests into the standalone project root.
- [x] 2.2 Move or copy required language-core modules into the standalone project, including LSP, settings, formatter, analyzer, DevDocs, tree-sitter, and output formatter modules.
- [x] 2.3 Move or copy required `tree-sitter-queries` and local `tree-sitter-wasm` assets into the standalone project.
- [x] 2.4 Rewrite TypeScript imports so project source and tests do not reference files outside the standalone project root.
- [x] 2.5 Remove or isolate Pi-only compatibility code from the standalone CLI package.

## 3. Runtime Behavior

- [x] 3.1 Keep command validation for `lsp`, `format`, `analyze`, `config`, `capabilities`, `serve`, and `session-close`.
- [x] 3.2 Keep JSON response envelopes stable across local and server-mode execution.
- [x] 3.3 Update config loading to use defaults, flags, `openlsp.config.json`, `extends`, and explicit inline environment config without reading `.pi/settings.json`.
- [x] 3.4 Verify server mode exposes `GET /health` and `POST /command` with the same command schema as local execution.
- [x] 3.5 Verify session reuse and session close behavior still work from the standalone runtime.

## 4. Tests and Validation

- [x] 4.1 Add or update tests for standalone package metadata and project-local command execution.
- [x] 4.2 Add a no-parent-import validation check for `src` and `tests`.
- [x] 4.3 Add or update tests proving config resolution ignores `.pi/settings.json`.
- [x] 4.4 Run validation from the standalone project root: install dependencies if needed, typecheck, unit tests, CLI smoke command, and build.
- [x] 4.5 Record any external language server binaries that are required for integration behavior but absent from the local environment.
