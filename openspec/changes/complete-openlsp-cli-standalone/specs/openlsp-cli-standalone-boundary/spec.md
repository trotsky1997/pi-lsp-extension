## ADDED Requirements

### Requirement: Project-local production source boundary

The `openlsp-cli` package SHALL keep all production TypeScript source dependencies inside the package root or in declared external dependencies.

#### Scenario: Production source import validation

- **WHEN** a developer validates imports under `openlsp-cli/src`
- **THEN** no production source file imports TypeScript source from the parent Pi extension directory

#### Scenario: Core modules are available locally

- **WHEN** the CLI needs LSP, settings, formatter, analyzer, DevDocs, tree-sitter, or output-formatting behavior
- **THEN** those modules resolve to files inside `openlsp-cli` or to declared package dependencies

### Requirement: Standalone TypeScript validation

The `openlsp-cli` package SHALL expose and pass a project-local typecheck command.

#### Scenario: Typecheck script exists

- **WHEN** a developer reads `openlsp-cli/package.json`
- **THEN** the scripts include `typecheck`

#### Scenario: Typecheck passes from package root

- **WHEN** a developer runs the typecheck script with the working directory set to `openlsp-cli`
- **THEN** TypeScript validation completes successfully without checking parent repository source files through CLI imports

### Requirement: Standalone validation sequence

The `openlsp-cli` package SHALL support a repeatable validation sequence for independent development and extraction.

#### Scenario: Full validation succeeds

- **WHEN** a developer runs typecheck, unit tests, a capabilities smoke command, and the executable build from `openlsp-cli`
- **THEN** all commands complete successfully using only project-local source and declared dependencies

#### Scenario: No-parent-import regression fails validation

- **WHEN** a production source file under `openlsp-cli/src` imports a parent-directory TypeScript module
- **THEN** project validation fails with an error identifying the boundary violation

### Requirement: Pi compatibility remains outside native config

The standalone CLI SHALL keep Pi-specific settings translation outside native config resolution.

#### Scenario: Native config ignores Pi settings

- **WHEN** a workspace contains `.pi/settings.json` but no native `openlsp.config.json` or inline `OPENLSP_CONFIG_JSON`
- **THEN** `openlsp-cli` resolves configuration from defaults and supported native sources only

#### Scenario: Parent adapter can delegate to CLI

- **WHEN** the parent Pi integration delegates an operation to `openlsp-cli`
- **THEN** Pi settings translation happens before invoking the CLI and does not require the standalone CLI to read `.pi/settings.json`
