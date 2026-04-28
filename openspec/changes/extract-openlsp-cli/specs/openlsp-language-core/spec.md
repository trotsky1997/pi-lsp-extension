## ADDED Requirements

### Requirement: Language Core Is Project Local
The language core SHALL live inside the standalone project and SHALL provide the LSP, formatter, analyzer, settings, DevDocs, tree-sitter, and result-formatting modules required by the CLI.

#### Scenario: Resolving core imports
- **WHEN** TypeScript resolves imports from CLI source files
- **THEN** all language-core imports resolve to files inside the `openlsp-cli` project root

### Requirement: Built-In Adapters Are Discoverable
The language core SHALL expose built-in LSP server, formatter, and analyzer capabilities to the adapter registry so the CLI can report and select available adapters.

#### Scenario: Listing capabilities
- **WHEN** a caller runs the `capabilities` command
- **THEN** the response includes built-in LSP, formatter, and analyzer capabilities from project-local modules

### Requirement: Formatter and Analyzer Execution Honors Config
The language core SHALL select formatter and analyzer adapters according to file type, project config, command preferences, disabled adapters, custom commands, arguments, environment values, and root markers.

#### Scenario: Running a formatter with a command preference
- **WHEN** config selects a formatter for the `format` command
- **THEN** the CLI disables other matching formatters for that invocation and runs the selected formatter when available

#### Scenario: Running analyzers with command preferences
- **WHEN** config selects analyzers for the `analyze` command
- **THEN** the CLI runs only the selected analyzer adapters that match the target file

### Requirement: LSP Operations Preserve Existing Behavior
The language core SHALL support diagnostics, workspace diagnostics, navigation, hover, symbols, call hierarchy, signature help, rename, folding ranges, and code actions through the project-local LSP manager.

#### Scenario: Executing a file-scoped LSP operation
- **WHEN** a caller runs an LSP operation with a file path and required position
- **THEN** the LSP manager opens the file, selects a matching backend, executes the operation, and returns a formatted result

#### Scenario: Executing diagnostics
- **WHEN** a caller requests diagnostics for a supported file
- **THEN** the LSP manager waits for diagnostics, applies the requested severity filter, and returns both text and structured diagnostics

### Requirement: Tree-Sitter Assets Move with the Project
The language core SHALL include tree-sitter query files and required local WASM assets under the standalone project root, and tree-sitter fallback operations SHALL resolve those assets through project-local paths.

#### Scenario: Loading tree-sitter queries
- **WHEN** fallback symbol or highlight behavior loads a tree-sitter query
- **THEN** the query path resolves inside the standalone project

#### Scenario: Loading local WASM assets
- **WHEN** markdown tree-sitter support loads its local WASM file
- **THEN** the WASM path resolves inside the standalone project
