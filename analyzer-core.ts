import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getFormatterEnv, loadResolvedLspSettings, type AnalyzerSettings } from "./lsp-settings.js";

interface AnalyzerCommand {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  outputFile?: string;
}

interface AnalyzerConfig {
  id: string;
  extensions: string[];
  fileNames?: string[];
  rootMarkers?: string[];
  resolveCommand: (filePath: string, cwd: string, settings: AnalyzerSettings) => AnalyzerCommand | undefined;
  parseOutput: (stdout: string, filePath: string, command: AnalyzerCommand) => AnalyzerFinding[];
}

export interface AnalyzerFinding {
  source: string;
  ruleId?: string;
  message: string;
  severity: "error" | "warning" | "info";
  filePath: string;
  line: number;
  column: number;
}

export interface AnalyzerRunResult {
  analyzerId?: string;
  analyzerIds?: string[];
  findings: AnalyzerFinding[];
  skipped?: string;
  error?: string;
  errors?: string[];
}

const SEARCH_PATHS = [
  ...(process.env.PATH?.split(path.delimiter) || []),
  "/usr/local/bin",
  "/opt/homebrew/bin",
  `${process.env.HOME}/.local/bin`,
  `${process.env.HOME}/.cargo/bin`,
  `${process.env.HOME}/.npm-global/bin`,
  `${process.env.HOME}/.bun/bin`,
];

function which(cmd: string): string | undefined {
  const ext = process.platform === "win32" ? ".exe" : "";
  for (const dir of SEARCH_PATHS) {
    const full = path.join(dir, cmd + ext);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    } catch {
      // ignore
    }
  }
}

function findNearestFile(startDir: string, targets: string[], stopDir: string): string | undefined {
  let current = path.resolve(startDir);
  const stop = path.resolve(stopDir);
  while (current.length >= stop.length) {
    for (const target of targets) {
      const candidate = path.join(current, target);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function analyzerCwd(filePath: string, cwd: string, settings: AnalyzerSettings, fallbackMarkers: string[] = []): string {
  const markers = settings.rootMarkers && settings.rootMarkers.length > 0 ? settings.rootMarkers : fallbackMarkers;
  if (markers.length === 0) return cwd;
  const match = findNearestFile(path.dirname(filePath), markers, cwd);
  return match ? path.dirname(match) : cwd;
}

function buildAnalyzerEnv(settings: AnalyzerSettings): Record<string, string> | undefined {
  const env = getFormatterEnv(settings);
  return env ? { ...process.env, ...env } as Record<string, string> : undefined;
}

function configuredAnalyzerCommand(
  filePath: string,
  cwd: string,
  settings: AnalyzerSettings,
  defaultCommand: (root: string) => string | undefined,
  defaultArgs: (file: string, root: string) => { args: string[]; outputFile?: string },
  fallbackMarkers: string[] = [],
): AnalyzerCommand | undefined {
  if (settings.disabled) return undefined;

  const root = analyzerCwd(filePath, cwd, settings, fallbackMarkers);
  const command = settings.command ?? defaultCommand(root);
  if (!command) return undefined;

  const defaultCommandConfig = defaultArgs(filePath, root);
  return {
    command,
    args: settings.args ?? defaultCommandConfig.args,
    cwd: root,
    env: buildAnalyzerEnv(settings),
    outputFile: defaultCommandConfig.outputFile,
  };
}

function directBinaryAnalyzer(
  id: string,
  extensions: string[],
  binaryName: string,
  defaultArgs: (file: string, root: string) => { args: string[]; outputFile?: string },
  parseOutput: (stdout: string, filePath: string, command: AnalyzerCommand) => AnalyzerFinding[],
  options: { rootMarkers?: string[]; fileNames?: string[] } = {},
): AnalyzerConfig {
  return {
    id,
    extensions,
    fileNames: options.fileNames,
    rootMarkers: options.rootMarkers,
    resolveCommand: (filePath, cwd, settings) => configuredAnalyzerCommand(
      filePath,
      cwd,
      settings,
      () => which(binaryName),
      defaultArgs,
      options.rootMarkers,
    ),
    parseOutput,
  };
}

function normalizeSeverity(value: string | undefined): "error" | "warning" | "info" {
  const upper = (value ?? "").toUpperCase();
  if (upper === "ERROR") return "error";
  if (upper === "INFO") return "info";
  return "warning";
}

function readOutputFileIfPresent(command: AnalyzerCommand, stdout: string): string {
  if (!command.outputFile) return stdout;
  try {
    if (fs.existsSync(command.outputFile)) return fs.readFileSync(command.outputFile, "utf-8");
  } catch {}
  return stdout;
}

function indexToLineColumn(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i++) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function normalizeLinkPathForSource(value: string): string {
  return value.split(path.sep).join("/");
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildLycheeCandidates(filePath: string, rawUrl: string): string[] {
  const candidates = new Set<string>();
  const decodedUrl = safeDecodeURIComponent(rawUrl);
  candidates.add(rawUrl);
  candidates.add(decodedUrl);

  try {
    if (decodedUrl.startsWith("file://")) {
      const targetPath = fileURLToPath(decodedUrl);
      const normalizedTargetPath = normalizeLinkPathForSource(targetPath);
      const relativePath = normalizeLinkPathForSource(path.relative(path.dirname(filePath), targetPath));

      candidates.add(normalizedTargetPath);
      candidates.add(relativePath);
      if (relativePath && !relativePath.startsWith(".")) candidates.add(`./${relativePath}`);
      candidates.add(path.basename(targetPath));
    }
  } catch {
    // Ignore URL parsing issues and keep best-effort string matching.
  }

  return [...candidates].filter(Boolean).sort((left, right) => right.length - left.length);
}

function formatLycheeUrl(filePath: string, rawUrl: string): string {
  try {
    if (rawUrl.startsWith("file://")) {
      const targetPath = fileURLToPath(rawUrl);
      const relativePath = normalizeLinkPathForSource(path.relative(path.dirname(filePath), targetPath));
      if (!relativePath) return path.basename(targetPath);
      return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
    }
  } catch {
    // Fall through to the original URL.
  }
  return safeDecodeURIComponent(rawUrl);
}

function findLycheeLocation(filePath: string, rawUrl: string): { line: number; column: number } {
  try {
    const source = fs.readFileSync(filePath, "utf-8");
    for (const candidate of buildLycheeCandidates(filePath, rawUrl)) {
      const index = source.indexOf(candidate);
      if (index >= 0) return indexToLineColumn(source, index);
    }
  } catch {
    // Ignore file read errors and fall back to 1:1.
  }
  return { line: 1, column: 1 };
}

function parseSemgrepOutput(stdout: string, fallbackFilePath: string, command: AnalyzerCommand): AnalyzerFinding[] {
  try {
    const parsed = JSON.parse(readOutputFileIfPresent(command, stdout)) as {
      results?: Array<{
        check_id?: string;
        path?: string;
        extra?: { message?: string; severity?: string };
        start?: { line?: number; col?: number };
      }>;
    };
    return (parsed.results ?? []).map((result) => ({
      source: "semgrep",
      ruleId: result.check_id,
      message: result.extra?.message ?? result.check_id ?? "Semgrep finding",
      severity: normalizeSeverity(result.extra?.severity),
      filePath: result.path ? path.resolve(result.path) : fallbackFilePath,
      line: result.start?.line ?? 1,
      column: result.start?.col ?? 1,
    }));
  } catch {
    return [];
  }
}

function parseRuffOutput(stdout: string, fallbackFilePath: string, command: AnalyzerCommand): AnalyzerFinding[] {
  try {
    const parsed = JSON.parse(readOutputFileIfPresent(command, stdout)) as Array<{
      code?: string;
      message?: string;
      filename?: string;
      location?: { row?: number; column?: number };
    }>;
    return parsed.map((result) => ({
      source: "ruff",
      ruleId: result.code,
      message: result.message ?? result.code ?? "Ruff finding",
      severity: "warning",
      filePath: result.filename ? path.resolve(result.filename) : fallbackFilePath,
      line: result.location?.row ?? 1,
      column: result.location?.column ?? 1,
    }));
  } catch {
    return [];
  }
}

function parseGolangciLintOutput(stdout: string, _fallbackFilePath: string, command: AnalyzerCommand): AnalyzerFinding[] {
  try {
    const parsed = JSON.parse(readOutputFileIfPresent(command, stdout)) as {
      Issues?: Array<{
        FromLinter?: string;
        Text?: string;
        Severity?: string;
        Pos?: { Filename?: string; Line?: number; Column?: number };
      }>;
    };
    return (parsed.Issues ?? []).map((issue) => ({
      source: issue.FromLinter ?? "golangci-lint",
      ruleId: issue.FromLinter,
      message: issue.Text ?? "golangci-lint finding",
      severity: normalizeSeverity(issue.Severity),
      filePath: issue.Pos?.Filename ? path.resolve(issue.Pos.Filename) : "",
      line: issue.Pos?.Line ?? 1,
      column: issue.Pos?.Column ?? 1,
    }));
  } catch {
    return [];
  }
}

function parseMarkdownlintOutput(stdout: string, fallbackFilePath: string, command: AnalyzerCommand): AnalyzerFinding[] {
  try {
    const parsed = JSON.parse(readOutputFileIfPresent(command, stdout)) as Array<{
      fileName?: string;
      lineNumber?: number;
      ruleNames?: string[];
      ruleDescription?: string;
      errorDetail?: string;
      errorContext?: string;
    }>;
    return parsed.map((issue) => ({
      source: "markdownlint",
      ruleId: issue.ruleNames?.[0],
      message: [issue.ruleDescription, issue.errorDetail, issue.errorContext].filter(Boolean).join(" - ") || issue.ruleNames?.[0] || "markdownlint finding",
      severity: "warning",
      filePath: issue.fileName ? path.resolve(issue.fileName) : fallbackFilePath,
      line: issue.lineNumber ?? 1,
      column: 1,
    }));
  } catch {
    return [];
  }
}

function parseShellcheckOutput(stdout: string, fallbackFilePath: string, command: AnalyzerCommand): AnalyzerFinding[] {
  try {
    const parsed = JSON.parse(readOutputFileIfPresent(command, stdout)) as Array<{
      code?: number;
      file?: string;
      level?: string;
      line?: number;
      column?: number;
      message?: string;
    }>;
    return parsed.map((issue) => ({
      source: "shellcheck",
      ruleId: issue.code ? `SC${issue.code}` : undefined,
      message: issue.message ?? "shellcheck finding",
      severity: normalizeSeverity(issue.level),
      filePath: issue.file ? path.resolve(issue.file) : fallbackFilePath,
      line: issue.line ?? 1,
      column: issue.column ?? 1,
    }));
  } catch {
    return [];
  }
}

function parseHadolintOutput(stdout: string, fallbackFilePath: string, command: AnalyzerCommand): AnalyzerFinding[] {
  try {
    const parsed = JSON.parse(readOutputFileIfPresent(command, stdout)) as Array<{
      code?: string;
      file?: string;
      level?: string;
      line?: number;
      column?: number;
      message?: string;
    }>;
    return parsed.map((issue) => ({
      source: "hadolint",
      ruleId: issue.code,
      message: issue.message ?? issue.code ?? "hadolint finding",
      severity: normalizeSeverity(issue.level),
      filePath: issue.file ? path.resolve(issue.file) : fallbackFilePath,
      line: issue.line ?? 1,
      column: issue.column ?? 1,
    }));
  } catch {
    return [];
  }
}

function parseSlopgrepOutput(stdout: string, fallbackFilePath: string, command: AnalyzerCommand): AnalyzerFinding[] {
  try {
    const parsed = JSON.parse(readOutputFileIfPresent(command, stdout)) as {
      findings?: Array<{
        rule_id?: string;
        id?: string;
        message?: string;
        severity?: string;
        path?: string;
        file?: string;
        line?: number;
        column?: number;
        start?: { line?: number; column?: number; col?: number };
      }>;
      results?: Array<{
        rule_id?: string;
        id?: string;
        message?: string;
        severity?: string;
        path?: string;
        file?: string;
        line?: number;
        column?: number;
        start?: { line?: number; column?: number; col?: number };
      }>;
    };
    const items = parsed.findings ?? parsed.results ?? [];
    return items.map((issue) => ({
      source: "slopgrep",
      ruleId: issue.rule_id ?? issue.id,
      message: issue.message ?? issue.rule_id ?? issue.id ?? "slopgrep finding",
      severity: normalizeSeverity(issue.severity),
      filePath: issue.path ? path.resolve(issue.path) : issue.file ? path.resolve(issue.file) : fallbackFilePath,
      line: issue.start?.line ?? issue.line ?? 1,
      column: issue.start?.column ?? issue.start?.col ?? issue.column ?? 1,
    }));
  } catch {
    return [];
  }
}

function parseSloppylintOutput(stdout: string, fallbackFilePath: string, command: AnalyzerCommand): AnalyzerFinding[] {
  try {
    const parsed = JSON.parse(readOutputFileIfPresent(command, stdout)) as {
      issues?: Array<{
        rule?: string;
        check?: string;
        message?: string;
        severity?: string;
        file?: string;
        path?: string;
        line?: number;
        column?: number;
      }>;
      findings?: Array<{
        rule?: string;
        check?: string;
        message?: string;
        severity?: string;
        file?: string;
        path?: string;
        line?: number;
        column?: number;
      }>;
    };
    const items = parsed.issues ?? parsed.findings ?? [];
    return items.map((issue) => ({
      source: "sloppylint",
      ruleId: issue.rule ?? issue.check,
      message: issue.message ?? issue.rule ?? issue.check ?? "sloppylint finding",
      severity: normalizeSeverity(issue.severity),
      filePath: issue.file ? path.resolve(issue.file) : issue.path ? path.resolve(issue.path) : fallbackFilePath,
      line: issue.line ?? 1,
      column: issue.column ?? 1,
    }));
  } catch {
    return [];
  }
}

function parseKarpeSlopOutput(stdout: string, fallbackFilePath: string, command: AnalyzerCommand): AnalyzerFinding[] {
  try {
    const parsed = JSON.parse(readOutputFileIfPresent(command, stdout)) as {
      issues?: Array<{
        type?: string;
        id?: string;
        message?: string;
        severity?: string;
        file?: string;
        path?: string;
        line?: number;
        column?: number;
      }>;
      findings?: Array<{
        type?: string;
        id?: string;
        message?: string;
        severity?: string;
        file?: string;
        path?: string;
        line?: number;
        column?: number;
      }>;
    };
    const items = parsed.issues ?? parsed.findings ?? [];
    return items.map((issue) => ({
      source: "karpeslop",
      ruleId: issue.type ?? issue.id,
      message: issue.message ?? issue.type ?? issue.id ?? "karpeslop finding",
      severity: normalizeSeverity(issue.severity),
      filePath: issue.file ? path.resolve(issue.file) : issue.path ? path.resolve(issue.path) : fallbackFilePath,
      line: issue.line ?? 1,
      column: issue.column ?? 1,
    }));
  } catch {
    return [];
  }
}

function parseLycheeOutput(stdout: string, fallbackFilePath: string, command: AnalyzerCommand): AnalyzerFinding[] {
  try {
    const parsed = JSON.parse(readOutputFileIfPresent(command, stdout)) as {
      error_map?: Record<string, Array<{
        url?: string;
        status?: { text?: string; details?: string };
      }>>;
    };

    const findings: AnalyzerFinding[] = [];
    for (const [inputPath, issues] of Object.entries(parsed.error_map ?? {})) {
      const resolvedPath = path.isAbsolute(inputPath)
        ? inputPath
        : inputPath && inputPath !== "-"
          ? path.resolve(command.cwd, inputPath)
          : fallbackFilePath;

      for (const issue of issues ?? []) {
        const url = issue.url ?? "unknown link";
        const statusText = issue.status?.text ?? "Broken link";
        const details = issue.status?.details ? ` - ${issue.status.details}` : "";
        const position = findLycheeLocation(resolvedPath, url);
        findings.push({
          source: "lychee",
          message: `${formatLycheeUrl(resolvedPath, url)} - ${statusText}${details}`,
          severity: "warning",
          filePath: resolvedPath,
          line: position.line,
          column: position.column,
        });
      }
    }
    return findings;
  } catch {
    return [];
  }
}

const DEFAULT_SEMGREP_EXTENSIONS = [
  ".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".php", ".yaml", ".yml",
  ".tf", ".c", ".cc", ".cpp", ".cs", ".kt", ".swift", ".scala", ".sh", ".md",
];

export const ANALYZERS: AnalyzerConfig[] = [
  directBinaryAnalyzer(
    "semgrep",
    DEFAULT_SEMGREP_EXTENSIONS,
    "semgrep",
    (file) => ({ args: ["scan", "--json", "--quiet", "--config=auto", file] }),
    parseSemgrepOutput,
    { rootMarkers: [".git", "semgrep.yml", ".semgrep.yml", ".semgrepignore"] },
  ),
  directBinaryAnalyzer(
    "ruff-check",
    [".py", ".pyi"],
    "ruff",
    (file) => ({ args: ["check", "--output-format", "json", file] }),
    parseRuffOutput,
    { rootMarkers: ["pyproject.toml", "ruff.toml"] },
  ),
  directBinaryAnalyzer(
    "golangci-lint",
    [".go"],
    "golangci-lint",
    (_file, root) => ({ args: ["run", "--out-format", "json", "./..."] }),
    parseGolangciLintOutput,
    { rootMarkers: ["go.work", "go.mod", ".golangci.yml", ".golangci.yaml", ".golangci.toml", ".golangci.json"] },
  ),
  directBinaryAnalyzer(
    "markdownlint",
    [".md", ".mdx"],
    "markdownlint",
    (file) => ({ args: ["--json", file] }),
    parseMarkdownlintOutput,
  ),
  directBinaryAnalyzer(
    "lychee",
    [".md", ".mdx", ".markdown", ".html", ".htm", ".txt", ".xml", ".css"],
    "lychee",
    (file) => ({ args: ["--format", "json", "--no-progress", file] }),
    parseLycheeOutput,
    { rootMarkers: ["lychee.toml", ".lycheeignore", ".git"] },
  ),
  directBinaryAnalyzer(
    "shellcheck",
    [".sh", ".bash", ".zsh"],
    "shellcheck",
    (file) => ({ args: ["--format", "json", file] }),
    parseShellcheckOutput,
  ),
  directBinaryAnalyzer(
    "hadolint",
    [],
    "hadolint",
    (file) => ({ args: ["-f", "json", file] }),
    parseHadolintOutput,
    { fileNames: ["Dockerfile"] },
  ),
  directBinaryAnalyzer(
    "slopgrep",
    [".md", ".mdx", ".txt", ".rst", ".adoc", ".tex"],
    "slopgrep",
    (file) => ({ args: ["scan", "--json", file] }),
    parseSlopgrepOutput,
  ),
  directBinaryAnalyzer(
    "sloppylint",
    [".py", ".pyi"],
    "sloppylint",
    (file, root) => {
      const outputFile = path.join(root, ".sloppylint-report.json");
      return { args: [file, "--output", outputFile], outputFile };
    },
    parseSloppylintOutput,
    { rootMarkers: ["pyproject.toml", ".git"] },
  ),
  directBinaryAnalyzer(
    "karpeslop",
    [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"],
    "karpeslop",
    (_file, root) => {
      const outputFile = path.join(root, "ai-slop-report.json");
      return { args: ["--quiet"], outputFile };
    },
    parseKarpeSlopOutput,
    { rootMarkers: ["package.json", "tsconfig.json", "jsconfig.json", ".karpesloprc.json"] },
  ),
];

export function getAnalyzerConfigsForFile(filePath: string, cwd: string = process.cwd()): AnalyzerConfig[] {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath);
  const settings = loadResolvedLspSettings(cwd);
  if (!settings.analyzerEnabled) return [];
  return ANALYZERS.filter((analyzer) => {
    const overrides = settings.analyzers[analyzer.id];
    if (overrides?.disabled) return false;
    const extensions = overrides?.extensions ?? analyzer.extensions;
    const fileNames = overrides?.fileNames ?? analyzer.fileNames ?? [];
    return extensions.includes(ext) || fileNames.includes(baseName);
  });
}

function runCommand(command: AnalyzerCommand): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(command.command, command.args, {
        cwd: command.cwd,
        env: command.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
    } catch (error) {
      reject(error);
    }
  });
}

export async function runAnalyzersForFile(filePath: string, cwd: string): Promise<AnalyzerRunResult> {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  if (!fs.existsSync(absPath)) return { findings: [], skipped: "file_missing" };

  const settings = loadResolvedLspSettings(cwd);
  if (!settings.analyzerEnabled || settings.analyzerHookMode === "disabled") {
    return { findings: [], skipped: "analyzer_disabled" };
  }

  const candidates = getAnalyzerConfigsForFile(absPath, cwd);
  if (candidates.length === 0) return { findings: [], skipped: "no_match" };

  const analyzerIds: string[] = [];
  const findings: AnalyzerFinding[] = [];
  const errors: string[] = [];

  for (const analyzer of candidates) {
    const command = analyzer.resolveCommand(absPath, cwd, settings.analyzers[analyzer.id] ?? {});
    if (!command) continue;

    analyzerIds.push(analyzer.id);

    try {
      const result = await runCommand(command);
      const parsedFindings = analyzer.parseOutput(result.stdout, absPath, command).filter((finding) => finding.filePath === "" || path.resolve(finding.filePath) === absPath);
      findings.push(...parsedFindings);

      if (result.code !== 0 && parsedFindings.length === 0) {
        errors.push(`${analyzer.id}: ${result.stderr.trim() || (result.signal ? `analyzer exited via signal ${result.signal}` : `analyzer exited with code ${result.code}`)}`);
        continue;
      }
      if (result.stderr.trim()) errors.push(`${analyzer.id}: ${result.stderr.trim()}`);
    } catch (error) {
      errors.push(`${analyzer.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (analyzerIds.length === 0) return { findings: [], skipped: "unavailable" };

  return {
    analyzerId: analyzerIds[0],
    analyzerIds,
    findings,
    error: errors[0],
    errors: errors.length > 0 ? errors : undefined,
  };
}
