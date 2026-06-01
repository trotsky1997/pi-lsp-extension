# openlsp-cli migration

This repository now contains an in-progress extraction called `openlsp-cli` in
`openlsp-cli/`.

## What changed

- The new CLI defines a stable JSON protocol for LSP-style operations,
  formatting, analyzer runs, config inspection, capability discovery, and
  remote session management.
- Configuration is moving from Pi-only `.pi/settings.json` semantics toward a
  canonical `openlsp.config.json` model with `extends`, adapter manifests, and
  command-level preferences.
- A thin Pi bridge in `openlsp-pi-adapter.ts` translates `.pi/settings.json`
  into canonical config and delegates LSP tool execution to `openlsp-cli`
  through Bun.

## Current compatibility model

- Existing `lsp-pi` code still provides the legacy in-process implementation.
- `lsp-tool.ts` now attempts to delegate to `openlsp-cli` first and falls back
  to the legacy implementation if the Bun bridge is unavailable.
- Hook-driven diagnostics in `lsp.ts` still use the legacy path for now.

## Suggested next steps

1. Expand the Pi hook path so formatter and analyzer hooks also delegate through
   `openlsp-cli`.
2. Move more legacy registries into the extracted package once Bun-native
   adapter implementations replace the current compatibility layer.
3. Add a published package flow for `openlsp-cli` once the command surface and
   remote protocol stabilize.
