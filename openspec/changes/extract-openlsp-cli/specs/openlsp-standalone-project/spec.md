## ADDED Requirements

### Requirement: Project Boundary Is Self Contained
The `openlsp-cli` project SHALL contain every source file, runtime asset, package metadata file, lockfile, test, and documentation file needed to develop and run the CLI without reading TypeScript source from the Pi extension parent repository.

#### Scenario: Checking for parent imports
- **WHEN** a developer searches the `openlsp-cli` source and tests for imports that resolve outside the project root
- **THEN** no import path references the Pi extension parent tree

#### Scenario: Running from project root
- **WHEN** a developer runs the project test script with the working directory set to `openlsp-cli`
- **THEN** tests use project-local source files and project-local configuration

### Requirement: Package Metadata Defines the CLI Project
The project SHALL include package metadata that identifies `openlsp-cli` as a standalone TypeScript/Bun CLI project, declares its runtime dependencies, exposes an executable entry, and provides scripts for development, typechecking, tests, and build.

#### Scenario: Inspecting package metadata
- **WHEN** a developer opens `package.json`
- **THEN** the file defines the `openlsp-cli` package, a CLI executable entry, and scripts for `dev`, `typecheck`, `test`, and `build`

#### Scenario: Building the executable
- **WHEN** a developer runs the build script from the project root
- **THEN** the script produces an executable CLI artifact under the project build output directory

### Requirement: Documentation Describes Standalone Use
The project documentation SHALL describe installation, development, command usage, configuration, server mode, language binary expectations, and validation commands without requiring the user to understand the old Pi extension.

#### Scenario: Reading the README
- **WHEN** a developer reads the project README
- **THEN** the README explains how to run `openlsp-cli` commands, how to configure `openlsp.config.json`, and how to validate the project

### Requirement: Generated Artifacts Are Excluded from Source Control
The project SHALL exclude generated dependency directories and build outputs from source control while keeping source files, tests, lockfiles, docs, and required runtime assets trackable.

#### Scenario: Reviewing repository hygiene
- **WHEN** a developer checks ignore rules for the standalone project
- **THEN** dependency directories and build outputs are ignored, while source, tests, docs, lockfiles, and required tree-sitter assets remain eligible for tracking
