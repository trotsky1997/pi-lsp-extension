## ADDED Requirements

### Requirement: AST Language Registry

The system SHALL provide a first-class AST language registry for tree-sitter-backed languages in `openlsp-cli`.

#### Scenario: Language lookup by file path

- **WHEN** a caller asks the AST layer for the language of a supported file path
- **THEN** the registry resolves the language from configured extensions
- **AND** the returned language exposes its id, extensions, tree-sitter language object, query paths, metavariable configuration, `kindToId`, and `fieldToId`

#### Scenario: Supported operation check

- **WHEN** LSP fallback code asks whether a file supports a tree-sitter operation
- **THEN** the AST registry determines support using language registration and markdown fallback rules

### Requirement: AST Document Model

The system SHALL represent parsed source as an OpenLSP-owned AST document rather than exposing raw tree-sitter trees as the primary API.

#### Scenario: Parse source into document

- **WHEN** a caller parses source for a registered language
- **THEN** the AST layer returns a document containing the source, language, tree, root node facade, and optional absolute file path

#### Scenario: Parse file into document data

- **WHEN** a caller parses a supported file from disk
- **THEN** the AST layer reads the file, selects the language, parses it, and returns parsed file data for downstream fallback operations

### Requirement: AST Node Facade

The system SHALL wrap tree-sitter nodes in an OpenLSP node facade.

#### Scenario: Node metadata access

- **WHEN** a caller receives an AST node
- **THEN** the node exposes stable accessors for kind, kind id, text, range, named status, error status, missing status, children, named children, field children, traversal, and closest ancestor lookup

### Requirement: Pattern AST Parsing

The system SHALL parse source-like patterns with the same tree-sitter grammar used for the target language and convert them into an OpenLSP pattern AST.

#### Scenario: Parse source-like pattern

- **WHEN** a caller parses a pattern for a supported file path
- **THEN** the AST layer preprocesses metavariables, parses the pattern with the matching language grammar, and returns a pattern AST

#### Scenario: Metavariable capture nodes

- **WHEN** a pattern contains an uppercase metavariable token such as `$A`
- **THEN** the pattern AST represents it as a metavariable node that can capture matching source nodes

### Requirement: Structural Pattern Matching

The system SHALL match pattern ASTs against parsed document ASTs and return capture maps.

#### Scenario: Match pattern in document

- **WHEN** a caller searches a supported file with a source-like pattern
- **THEN** the AST layer parses the file, parses the pattern, traverses the document AST, and returns all structural matches

#### Scenario: Return captures

- **WHEN** a structural match includes metavariables
- **THEN** each match includes a capture map from metavariable name to captured AST nodes

### Requirement: Incremental Document Editing

The system SHALL support incremental AST document edits using tree-sitter old-tree reparsing.

#### Scenario: Reparse after edit

- **WHEN** a caller edits an AST document with byte offsets and replacement text
- **THEN** the document updates its source, edits the old tree, reparses with the old tree, and exposes the updated root and nodes

### Requirement: Included Range Parsing

The system SHALL support parsing explicit included ranges from a source document.

#### Scenario: Parse included ranges

- **WHEN** a caller provides byte ranges for a registered language and source document
- **THEN** the AST layer parses only those included ranges while preserving document-relative positions

### Requirement: LSP Fallback Uses AST Service

The system SHALL route tree-sitter fallback operations through the new AST service.

#### Scenario: Fallback diagnostics and navigation

- **WHEN** an LSP operation falls back to tree-sitter
- **THEN** `openlsp-cli` uses `AstService` for support checks, diagnostics, symbols, references, hover, highlights, workspace symbols, and folding ranges

#### Scenario: Old tree-sitter manager API removed

- **WHEN** production source or tests under `openlsp-cli` are searched
- **THEN** they do not reference `TreeSitterManager` or `getOrCreateTreeSitterManager`
