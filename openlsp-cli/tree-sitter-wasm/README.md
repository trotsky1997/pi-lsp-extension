# Tree-sitter WASM artifacts

## Markdown

`tree-sitter-markdown.wasm` is the vendored block-grammar artifact used by
`tree-sitter-wasm-core.ts` for Markdown structural fallback support.

Source grammar:

- package: `@tree-sitter-grammars/tree-sitter-markdown@0.3.2`
- grammar path inside package: `tree-sitter-markdown/`
- lineage: `tree-sitter-grammars/tree-sitter-markdown` / `tree-sitter-md`

Build notes:

- this repo currently uses the block grammar only
- inline Markdown navigation still uses lightweight handwritten parsing
- the artifact was built with `tree-sitter-cli` in WASM mode

Example rebuild flow:

```sh
TMP_DIR="$(mktemp -d)"
cd "$TMP_DIR"
npm pack @tree-sitter-grammars/tree-sitter-markdown
TARBALL="$(ls *.tgz)"
tar -xzf "$TARBALL"
cd package/tree-sitter-markdown
npx tree-sitter-cli build --wasm -o /path/to/lsp-pi/tree-sitter-wasm/tree-sitter-markdown.wasm
```
