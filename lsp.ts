/**
 * LSP Hook Extension for pi-coding-agent
 *
 * Provides automatic diagnostics feedback (default: agent end).
 * Can run after each write/edit or once per agent response.
 *
 * Usage:
 *   pi --extension ./lsp.ts
 *
 * Or load the directory to get both hook and tool:
 *   pi --extension ./lsp/
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { FileChangeType, type Diagnostic } from "vscode-languageserver-protocol";
import { getAnalyzerConfigsForFile, runAnalyzersForFile } from "./analyzer-core.js";
import { getFormatterConfigsForFile, runFormatterForFile } from "./formatter-core.js";
import { formatDiagnostic, getOrCreateManager, getServerConfigsForFile, shutdownManager } from "./lsp-core.js";
import { loadResolvedLspSettings, type AnalyzerHookMode, type FormatterHookMode, type HookMode, type PythonProvider } from "./lsp-settings.js";

type HookScope = "session" | "global" | "project";

const PYTHON_PROVIDER_LABELS: Record<Exclude<PythonProvider, "pyright">, string> = {
  basedpyright: "BasedPyright",
  ty: "Ty",
};

const DIAGNOSTICS_WAIT_MS_DEFAULT = 3000;

function diagnosticsWaitMsForFile(filePath: string): number {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".kt" || ext === ".kts") return 30000;
  if (ext === ".swift") return 20000;
  if (ext === ".rs") return 20000;
  return DIAGNOSTICS_WAIT_MS_DEFAULT;
}
const DIAGNOSTICS_PREVIEW_LINES = 10;
const LSP_IDLE_SHUTDOWN_MS = 2 * 60 * 1000;
const DIM = "\x1b[2m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", RESET = "\x1b[0m";
const DEFAULT_HOOK_MODE: HookMode = "agent_end";
const DEFAULT_PYTHON_PROVIDER: PythonProvider = "pyright";
const DEFAULT_FORMATTER_HOOK_MODE: FormatterHookMode = "write";
const DEFAULT_ANALYZER_HOOK_MODE: AnalyzerHookMode = "agent_end";
const SETTINGS_NAMESPACE = "lsp";
const LSP_CONFIG_ENTRY = "lsp-hook-config";

const WARMUP_MAP: Record<string, string> = {
  "pubspec.yaml": ".dart",
  "package.json": ".ts",
  "pyproject.toml": ".py",
  "ty.toml": ".py",
  "go.mod": ".go",
  "Cargo.toml": ".rs",
  "settings.gradle": ".kt",
  "settings.gradle.kts": ".kt",
  "build.gradle": ".kt",
  "build.gradle.kts": ".kt",
  "pom.xml": ".kt",
  "gradlew": ".kt",
  "gradle.properties": ".kt",
  "Package.swift": ".swift",
};

const MODE_LABELS: Record<HookMode, string> = {
  edit_write: "After each edit/write",
  agent_end: "At agent end",
  disabled: "Disabled",
};

const PROJECT_CONFIG_FILES = new Set([
  "pubspec.yaml",
  "analysis_options.yaml",
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "svelte.config.js",
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "pyrightconfig.json",
  "basedpyrightconfig.json",
  "ty.toml",
  "go.mod",
  "go.work",
  "Cargo.toml",
  "settings.gradle",
  "settings.gradle.kts",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
  "gradlew",
  "gradle.properties",
  "Package.swift",
]);

const DOCTOR_REPORT_RELATIVE_PATH = path.join(".pi", "lsp-doctor.md");
const DOCTOR_MAX_FILES = 25;

function normalizeHookMode(value: unknown): HookMode | undefined {
  if (value === "edit_write" || value === "agent_end" || value === "disabled") return value;
  if (value === "turn_end") return "agent_end";
  return undefined;
}

function normalizePythonProvider(value: unknown): PythonProvider | undefined {
  if (value === "pyright" || value === "basedpyright" || value === "ty") return value;
  return undefined;
}

function walkFiles(root: string, maxFiles: number): string[] {
  const results: string[] = [];
  const stack = [root];
  const ignoredDirs = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".turbo"]);

  while (stack.length > 0 && results.length < maxFiles) {
    const current = stack.pop();
    if (!current) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) results.push(fullPath);
    }
  }

  return results.sort();
}

async function writeDoctorReportFile(cwd: string, content: string): Promise<string> {
  const reportPath = path.join(cwd, DOCTOR_REPORT_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, content, "utf-8");
  return reportPath;
}

export interface LspConfigEntry {
  scope: HookScope;
  hookMode?: HookMode;
  pythonProvider?: PythonProvider;
}

interface LspResolvedUiState {
  hookMode: HookMode;
  hookScope: HookScope;
  pythonProvider: PythonProvider;
  pythonScope: HookScope;
  formatterEnabled: boolean;
  formatterHookMode: FormatterHookMode;
  analyzerEnabled: boolean;
  analyzerHookMode: AnalyzerHookMode;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readSettingsFile(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function getScopedSettingOrigin(globalValue: unknown, projectValue: unknown): HookScope {
  return projectValue !== undefined ? "project" : globalValue !== undefined ? "global" : "global";
}

export function resolveLspUiState(
  cwd: string,
  sessionEntry?: LspConfigEntry,
  globalSettingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json"),
): LspResolvedUiState {
  const resolved = loadResolvedLspSettings(cwd, {
    globalSettingsPath,
    projectSettingsPath: path.join(cwd, ".pi", "settings.json"),
  });
  const globalSettings = readSettingsFile(globalSettingsPath);
  const projectSettings = readSettingsFile(path.join(cwd, ".pi", "settings.json"));

  const globalLsp = isPlainObject(globalSettings[SETTINGS_NAMESPACE]) ? globalSettings[SETTINGS_NAMESPACE] : undefined;
  const projectLsp = isPlainObject(projectSettings[SETTINGS_NAMESPACE]) ? projectSettings[SETTINGS_NAMESPACE] : undefined;
  const globalHookMode = normalizeHookMode((globalLsp as { hookMode?: unknown } | undefined)?.hookMode)
    ?? (typeof (globalLsp as { hookEnabled?: unknown } | undefined)?.hookEnabled === "boolean"
      ? ((globalLsp as { hookEnabled?: boolean }).hookEnabled ? "edit_write" : "disabled")
      : undefined);
  const projectHookMode = normalizeHookMode((projectLsp as { hookMode?: unknown } | undefined)?.hookMode)
    ?? (typeof (projectLsp as { hookEnabled?: unknown } | undefined)?.hookEnabled === "boolean"
      ? ((projectLsp as { hookEnabled?: boolean }).hookEnabled ? "edit_write" : "disabled")
      : undefined);
  const globalProvider = normalizePythonProvider((globalLsp as { python?: { provider?: unknown } } | undefined)?.python?.provider);
  const projectProvider = normalizePythonProvider((projectLsp as { python?: { provider?: unknown } } | undefined)?.python?.provider);

  const diskHookMode = resolved.hookMode ?? DEFAULT_HOOK_MODE;
  const diskPythonProvider = resolved.pythonProvider ?? DEFAULT_PYTHON_PROVIDER;
  const effectiveHookMode = resolved.enabled ? diskHookMode : "disabled";
  const hookScope = getScopedSettingOrigin(globalHookMode, projectHookMode);
  const pythonScope = getScopedSettingOrigin(globalProvider, projectProvider);

  if (sessionEntry?.scope === "session") {
    return {
      hookMode: normalizeHookMode(sessionEntry.hookMode) ?? effectiveHookMode,
      hookScope: "session",
      pythonProvider: normalizePythonProvider(sessionEntry.pythonProvider) ?? diskPythonProvider,
      pythonScope: "session",
      formatterEnabled: resolved.formatterEnabled,
      formatterHookMode: resolved.formatterHookMode ?? DEFAULT_FORMATTER_HOOK_MODE,
      analyzerEnabled: resolved.analyzerEnabled,
      analyzerHookMode: resolved.analyzerHookMode ?? DEFAULT_ANALYZER_HOOK_MODE,
    };
  }

  return {
    hookMode: effectiveHookMode,
    hookScope: sessionEntry?.scope === "project" ? "project" : hookScope,
    pythonProvider: diskPythonProvider,
    pythonScope: sessionEntry?.scope === "project" ? "project" : pythonScope,
    formatterEnabled: resolved.formatterEnabled,
    formatterHookMode: resolved.formatterHookMode ?? DEFAULT_FORMATTER_HOOK_MODE,
    analyzerEnabled: resolved.analyzerEnabled,
    analyzerHookMode: resolved.analyzerHookMode ?? DEFAULT_ANALYZER_HOOK_MODE,
  };
}

function updateScopedLspSettings(filePath: string, hookMode: HookMode, pythonProvider: PythonProvider): boolean {
  try {
    const settings = readSettingsFile(filePath);
    const existingNamespace = isPlainObject(settings[SETTINGS_NAMESPACE]) ? settings[SETTINGS_NAMESPACE] : {};
    const existingPython = isPlainObject((existingNamespace as Record<string, unknown>).python)
      ? (existingNamespace as Record<string, unknown>).python as Record<string, unknown>
      : {};

    settings[SETTINGS_NAMESPACE] = {
      ...existingNamespace,
      hookMode,
      python: {
        ...existingPython,
        provider: pythonProvider,
      },
    };

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  type LspActivity = "idle" | "loading" | "working";

  let activeClients: Set<string> = new Set();
  let statusUpdateFn: ((key: string, text: string | undefined) => void) | null = null;
  let hookMode: HookMode = DEFAULT_HOOK_MODE;
  let pythonProvider: PythonProvider = DEFAULT_PYTHON_PROVIDER;
  let hookScope: HookScope = "global";
  let pythonScope: HookScope = "global";
  let formatterEnabled = true;
  let formatterHookMode: FormatterHookMode = DEFAULT_FORMATTER_HOOK_MODE;
  let analyzerEnabled = true;
  let analyzerHookMode: AnalyzerHookMode = DEFAULT_ANALYZER_HOOK_MODE;
  let activity: LspActivity = "idle";
  let diagnosticsAbort: AbortController | null = null;
  let shuttingDown = false;
  let idleShutdownTimer: NodeJS.Timeout | null = null;

  const touchedFiles: Map<string, boolean> = new Map();
  const pendingToolFileExists = new Map<string, boolean>();
  const globalSettingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");

  function isLspSettingsFile(filePath: string, cwd: string): boolean {
    const normalizedPath = path.resolve(filePath);
    return normalizedPath === path.resolve(globalSettingsPath)
      || normalizedPath === path.resolve(path.join(cwd, ".pi", "settings.json"));
  }

  function shouldReloadProjectConfig(filePath: string, cwd: string): boolean {
    const normalizedPath = path.resolve(filePath);
    return isLspSettingsFile(normalizedPath, cwd)
      || PROJECT_CONFIG_FILES.has(path.basename(normalizedPath));
  }

  function getLastHookEntry(ctx: ExtensionContext): LspConfigEntry | undefined {
    const branchEntries = ctx.sessionManager.getBranch();
    let latest: LspConfigEntry | undefined;

    for (const entry of branchEntries) {
      if (entry.type === "custom" && entry.customType === LSP_CONFIG_ENTRY) {
        latest = entry.data as LspConfigEntry | undefined;
      }
    }

    return latest;
  }

  function restoreHookState(ctx: ExtensionContext): void {
    const resolved = resolveLspUiState(ctx.cwd, undefined, globalSettingsPath);
    hookMode = resolved.hookMode;
    hookScope = resolved.hookScope;
    pythonProvider = resolved.pythonProvider;
    pythonScope = resolved.pythonScope;
    formatterEnabled = resolved.formatterEnabled;
    formatterHookMode = resolved.formatterHookMode;
    analyzerEnabled = resolved.analyzerEnabled;
    analyzerHookMode = resolved.analyzerHookMode;
  }

  function persistHookEntry(entry: LspConfigEntry): void {
    pi.appendEntry<LspConfigEntry>(LSP_CONFIG_ENTRY, entry);
  }

  function labelForMode(mode: HookMode): string {
    return MODE_LABELS[mode];
  }

  function messageContentToText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => (item && typeof item === "object" && "type" in item && (item as any).type === "text")
          ? String((item as any).text ?? "")
          : "")
        .filter(Boolean)
        .join("\n");
    }
    return "";
  }

  function formatDiagnosticsForDisplay(text: string): string {
    return text
      .replace(/\n?This file has errors, please fix\n/gi, "\n")
      .replace(/<\/?file_diagnostics>\n?/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function setActivity(next: LspActivity): void {
    activity = next;
    updateLspStatus();
  }

  function clearIdleShutdownTimer(): void {
    if (!idleShutdownTimer) return;
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }

  async function shutdownLspServersForIdle(): Promise<void> {
    diagnosticsAbort?.abort();
    diagnosticsAbort = null;
    setActivity("idle");

    await shutdownManager();
    activeClients.clear();
    updateLspStatus();
  }

  function scheduleIdleShutdown(): void {
    clearIdleShutdownTimer();

    idleShutdownTimer = setTimeout(() => {
      idleShutdownTimer = null;
      if (shuttingDown) return;
      void shutdownLspServersForIdle();
    }, LSP_IDLE_SHUTDOWN_MS);

    (idleShutdownTimer as any).unref?.();
  }

  function updateLspStatus(): void {
    if (!statusUpdateFn) return;

    const clients = activeClients.size > 0 ? [...activeClients].join(", ") : "";
    const clientsText = clients ? `${DIM}${clients}${RESET}` : "";
    const activityHint = activity === "idle" ? "" : `${DIM}•${RESET}`;
    const providerText = pythonProvider === "pyright"
      ? `${DIM}pyright${RESET}`
      : `${DIM}${PYTHON_PROVIDER_LABELS[pythonProvider]}${RESET}`;
    const formatterText = formatterEnabled && formatterHookMode !== "disabled"
      ? `${DIM}fmt:${formatterHookMode}${RESET}`
      : `${DIM}fmt:off${RESET}`;
    const analyzerText = analyzerEnabled && analyzerHookMode !== "disabled"
      ? `${DIM}an:${analyzerHookMode}${RESET}`
      : `${DIM}an:off${RESET}`;

    if (hookMode === "disabled") {
      const nextText = clientsText
        ? `${YELLOW}LSP${RESET} ${DIM}(tool)${RESET} ${providerText} ${formatterText} ${analyzerText}: ${clientsText}`
        : `${YELLOW}LSP${RESET} ${DIM}(tool)${RESET} ${providerText} ${formatterText} ${analyzerText}`;
      statusUpdateFn("lsp", nextText);
      return;
    }

    let text = `${GREEN}LSP${RESET}`;
    if (activityHint) text += ` ${activityHint}`;
    text += ` ${providerText}`;
    text += ` ${formatterText}`;
    text += ` ${analyzerText}`;
    if (clientsText) text += ` ${clientsText}`;
    statusUpdateFn("lsp", text);
  }

  function normalizeFilePath(filePath: string, cwd: string): string {
    return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  }

  pi.registerMessageRenderer("lsp-diagnostics", (message, options, theme) => {
    const content = formatDiagnosticsForDisplay(messageContentToText(message.content));
    if (!content) return new Text("", 0, 0);

    const expanded = options.expanded === true;
    const lines = content.split("\n");
    const maxLines = expanded ? lines.length : DIAGNOSTICS_PREVIEW_LINES;
    const display = lines.slice(0, maxLines);
    const remaining = lines.length - display.length;

    const styledLines = display.map((line) => {
      if (line.startsWith("File: ")) return theme.fg("muted", line);
      return theme.fg("toolOutput", line);
    });

    if (!expanded && remaining > 0) {
      styledLines.push(theme.fg("dim", `... (${remaining} more lines)`));
    }

    return new Text(styledLines.join("\n"), 0, 0);
  });

  function getServerConfig(filePath: string, cwd: string) {
    const settings = loadResolvedLspSettings(cwd);
    return getServerConfigsForFile(filePath, cwd, settings).find((config) => {
      const overrides = settings.servers[config.id] ?? {};
      return !!config.findRoot(filePath, cwd, overrides);
    }) ?? getServerConfigsForFile(filePath, cwd, settings)[0];
  }

  function ensureActiveClientForFile(filePath: string, cwd: string): string | undefined {
    const absPath = normalizeFilePath(filePath, cwd);
    const cfg = getServerConfig(absPath, cwd);
    if (!cfg) return undefined;

    if (!activeClients.has(cfg.id)) {
      activeClients.add(cfg.id);
      updateLspStatus();
    }

    return absPath;
  }

  function extractLspFiles(input: Record<string, unknown>): string[] {
    const files: string[] = [];

    if (typeof input.filePath === "string") files.push(input.filePath);
    if (typeof input.file === "string") files.push(input.file);
    if (Array.isArray(input.filePaths)) {
      for (const item of input.filePaths) {
        if (typeof item === "string") files.push(item);
      }
    }
    if (Array.isArray(input.files)) {
      for (const item of input.files) {
        if (typeof item === "string") files.push(item);
      }
    }

    return files;
  }

  function buildDiagnosticsOutput(
    filePath: string,
    diagnostics: Diagnostic[],
    cwd: string,
    includeFileHeader: boolean,
  ): { notification: string; errorCount: number; output: string } {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    const relativePath = path.relative(cwd, absPath);
    const errorCount = diagnostics.filter((e) => e.severity === 1).length;

    const MAX = 5;
    const lines = diagnostics.slice(0, MAX).map((e) => {
      const sev = e.severity === 1 ? "ERROR" : "WARN";
      return `${sev}[${e.range.start.line + 1}] ${e.message.split("\n")[0]}`;
    });

    let notification = `📋 ${relativePath}\n${lines.join("\n")}`;
    if (diagnostics.length > MAX) notification += `\n... +${diagnostics.length - MAX} more`;

    const header = includeFileHeader ? `File: ${relativePath}\n` : "";
    const output = `\n${header}This file has errors, please fix\n<file_diagnostics>\n${diagnostics.map(formatDiagnostic).join("\n")}\n</file_diagnostics>\n`;

    return { notification, errorCount, output };
  }

  function shouldRunFormatterForTool(toolName: string): boolean {
    if (!formatterEnabled || formatterHookMode === "disabled") return false;
    if (formatterHookMode === "write") return toolName === "write";
    return toolName === "write" || toolName === "edit";
  }

  function shouldRunAnalyzerForTool(toolName: string): boolean {
    if (!analyzerEnabled || analyzerHookMode === "disabled" || analyzerHookMode === "agent_end") return false;
    if (analyzerHookMode === "write") return toolName === "write";
    return toolName === "write" || toolName === "edit";
  }

  function buildFormatterMessage(cwd: string, filePath: string, formatterId: string, changed: boolean, error?: string): string {
    const relativePath = path.relative(cwd, filePath);
    if (error) return `\nFormatter ${formatterId} failed for ${relativePath}: ${error}\n`;
    return changed
      ? `\nFormatted ${relativePath} with ${formatterId}.\n`
      : `\nFormatter ${formatterId} checked ${relativePath}; no changes.\n`;
  }

  function buildAnalyzerMessage(cwd: string, filePath: string, analyzerId: string, findingCount: number, findings: Array<{ message: string; line: number; column: number; ruleId?: string }>, error?: string): string {
    const relativePath = path.relative(cwd, filePath);
    if (error && findingCount === 0) return `\nAnalyzer ${analyzerId} failed for ${relativePath}: ${error}\n`;
    const preview = findings.slice(0, 5).map((finding) => {
      const rule = finding.ruleId ? ` [${finding.ruleId}]` : "";
      return `- ${finding.line}:${finding.column}${rule} ${finding.message}`;
    }).join("\n");
    const remainder = findingCount > 5 ? `\n... +${findingCount - 5} more` : "";
    return findingCount > 0
      ? `\nAnalyzer ${analyzerId} found ${findingCount} issue(s) in ${relativePath}:\n${preview}${remainder}\n`
      : `\nAnalyzer ${analyzerId} checked ${relativePath}; no issues.\n`;
  }

  async function buildDoctorReport(ctx: ExtensionContext): Promise<string> {
    const settings = loadResolvedLspSettings(ctx.cwd);
    const manager = getOrCreateManager(ctx.cwd);
    const files = walkFiles(ctx.cwd, DOCTOR_MAX_FILES);
    const supportedFiles = files.filter((filePath) => getServerConfigsForFile(filePath, ctx.cwd, settings).length > 0);

    const lines: string[] = [
      "# LSP Doctor Report",
      "",
      `- Generated: ${new Date().toISOString()}`,
      `- Workspace: ${ctx.cwd}`,
      `- Global config: ${settings.globalSettingsPath}`,
      `- Project config: ${settings.projectSettingsPath}`,
      `- LSP enabled: ${settings.enabled}`,
      `- LSP hook mode: ${settings.hookMode ?? DEFAULT_HOOK_MODE}`,
      `- Python provider: ${settings.pythonProvider}`,
      `- Formatter enabled: ${settings.formatterEnabled}`,
      `- Formatter hook mode: ${settings.formatterHookMode}`,
      `- Analyzer enabled: ${settings.analyzerEnabled}`,
      `- Analyzer hook mode: ${settings.analyzerHookMode}`,
      "",
      "## Configured server overrides",
      "",
    ];

    const serverOverrideIds = Object.keys(settings.servers).sort();
    if (serverOverrideIds.length === 0) {
      lines.push("- None");
    } else {
      for (const id of serverOverrideIds) {
        lines.push(`- ${id}: ${JSON.stringify(settings.servers[id])}`);
      }
    }

    lines.push("", "## Configured formatter overrides", "");
    const formatterOverrideIds = Object.keys(settings.formatters).sort();
    if (formatterOverrideIds.length === 0) {
      lines.push("- None");
    } else {
      for (const id of formatterOverrideIds) {
        lines.push(`- ${id}: ${JSON.stringify(settings.formatters[id])}`);
      }
    }

    lines.push("", "## Configured analyzer overrides", "");
    const analyzerOverrideIds = Object.keys(settings.analyzers).sort();
    if (analyzerOverrideIds.length === 0) {
      lines.push("- None");
    } else {
      for (const id of analyzerOverrideIds) {
        lines.push(`- ${id}: ${JSON.stringify(settings.analyzers[id])}`);
      }
    }

    lines.push("", "## File checks", "");
    if (supportedFiles.length === 0) {
      lines.push("- No supported source files found in the first scanned workspace files.");
      return lines.join("\n");
    }

    for (const filePath of supportedFiles) {
      const relativePath = path.relative(ctx.cwd, filePath);
      const serverConfigs = getServerConfigsForFile(filePath, ctx.cwd, settings);
      const serverIds = serverConfigs.map((config) => config.id);
      const formatterIds = getFormatterConfigsForFile(filePath, ctx.cwd).map((formatter) => formatter.id);
      const analyzerIds = getAnalyzerConfigsForFile(filePath, ctx.cwd).map((analyzer) => analyzer.id);
      lines.push(`### ${relativePath}`);
      lines.push("");
      lines.push(`- Candidate servers: ${serverIds.join(", ") || "none"}`);
      lines.push(`- Candidate formatters: ${formatterIds.join(", ") || "none"}`);
      lines.push(`- Candidate analyzers: ${analyzerIds.join(", ") || "none"}`);

      try {
        const clients = await manager.getClientsForFile(filePath);
        lines.push(`- Active/initialized servers: ${clients.length > 0 ? clients.map((client: any) => client.root).join(", ") : "none"}`);
      } catch (error) {
        lines.push(`- Client initialization error: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        const result = await manager.touchFileAndWait(filePath, diagnosticsWaitMsForFile(filePath));
        if (result.unsupported) {
          lines.push(`- LSP status: unsupported`);
          if (result.error) lines.push(`- Reason: ${result.error}`);
        } else if (!result.receivedResponse) {
          lines.push(`- LSP status: no response`);
          if (result.error) lines.push(`- Reason: ${result.error}`);
        } else {
          lines.push(`- LSP status: responded`);
          lines.push(`- Diagnostics: ${result.diagnostics.length}`);
          const preview = result.diagnostics.slice(0, 5);
          if (preview.length === 0) {
            lines.push("- Diagnostic preview: none");
          } else {
            lines.push("- Diagnostic preview:");
            for (const diagnostic of preview) {
              lines.push(`  - ${formatDiagnostic(diagnostic)}`);
            }
          }
        }
      } catch (error) {
        lines.push(`- LSP check error: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        const analysis = await runAnalyzersForFile(filePath, ctx.cwd);
        if (analysis.skipped) {
          lines.push(`- Analyzer status: ${analysis.skipped}`);
        } else {
          lines.push(`- Analyzer status: ran ${analysis.analyzerId ?? "unknown"}`);
          lines.push(`- Analyzer findings: ${analysis.findings.length}`);
          if (analysis.error) lines.push(`- Analyzer stderr: ${analysis.error}`);
        }
      } catch (error) {
        lines.push(`- Analyzer check error: ${error instanceof Error ? error.message : String(error)}`);
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  async function collectDiagnostics(
    filePath: string,
    ctx: ExtensionContext,
    includeWarnings: boolean,
    includeFileHeader: boolean,
    notify = true,
  ): Promise<string | undefined> {
    const manager = getOrCreateManager(ctx.cwd);
    const absPath = ensureActiveClientForFile(filePath, ctx.cwd);
    if (!absPath) return undefined;

    try {
      const result = await manager.touchFileAndWait(absPath, diagnosticsWaitMsForFile(absPath));
      if (!result.receivedResponse) return undefined;

      const diagnostics = includeWarnings
        ? result.diagnostics
        : result.diagnostics.filter((d) => d.severity === 1);
      if (!diagnostics.length) return undefined;

      const report = buildDiagnosticsOutput(filePath, diagnostics, ctx.cwd, includeFileHeader);

      if (notify) {
        if (ctx.hasUI) ctx.ui.notify(report.notification, report.errorCount > 0 ? "error" : "warning");
        else console.error(report.notification);
      }

      return report.output;
    } catch {
      return undefined;
    }
  }

  async function collectAnalyzerDiagnostics(
    filePath: string,
    ctx: ExtensionContext,
  ): Promise<string | undefined> {
    const result = await runAnalyzersForFile(filePath, ctx.cwd);
    if (!result.analyzerId) return undefined;
    return buildAnalyzerMessage(ctx.cwd, filePath, result.analyzerId, result.findings.length, result.findings, result.error);
  }

  pi.registerCommand("lsp", {
    description: "Show LSP and formatter status",
    handler: async (args, ctx) => {
      restoreHookState(ctx);
      updateLspStatus();

      const command = args.trim();
      if (command === "doctor") {
        const content = await buildDoctorReport(ctx);
        const reportPath = await writeDoctorReportFile(ctx.cwd, content);
        const message = `LSP doctor report written to ${reportPath}`;
        if (ctx.hasUI) ctx.ui.notify(message, "info");
        else console.log(message);
        return;
      }

      const projectSettingsPath = path.join(ctx.cwd, ".pi", "settings.json");
      const providerLabel = pythonProvider === "pyright" ? "Pyright" : PYTHON_PROVIDER_LABELS[pythonProvider];
      const active = activeClients.size > 0 ? [...activeClients].join(", ") : "none";
      const lines = [
        `LSP hook: ${labelForMode(hookMode)} (${hookScope})`,
        `Python provider: ${providerLabel} (${pythonScope})`,
        `Formatter hook: ${formatterEnabled ? formatterHookMode : "disabled"}`,
        `Analyzer hook: ${analyzerEnabled ? analyzerHookMode : "disabled"}`,
        `Global config: ${globalSettingsPath}`,
        `Project config: ${projectSettingsPath}`,
        `Active servers: ${active}`,
        "",
        "Configuration is file-based only.",
        "Edit ~/.pi/agent/settings.json or .pi/settings.json to change LSP, formatter, or analyzer behavior.",
      ];

      if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
      else console.log(lines.join("\n"));
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    restoreHookState(ctx);
    statusUpdateFn = ctx.hasUI && ctx.ui.setStatus ? ctx.ui.setStatus.bind(ctx.ui) : null;
    updateLspStatus();

    if (hookMode === "disabled") return;

    const manager = getOrCreateManager(ctx.cwd);

    for (const [marker, ext] of Object.entries(WARMUP_MAP)) {
      if (fs.existsSync(path.join(ctx.cwd, marker))) {
        setActivity("loading");
        manager.getClientsForFile(path.join(ctx.cwd, `dummy${ext}`))
          .then((clients) => {
            if (clients.length > 0) {
              const cfg = getServerConfig(path.join(ctx.cwd, `dummy${ext}`), ctx.cwd);
              if (cfg) activeClients.add(cfg.id);
            }
          })
          .catch(() => {})
          .finally(() => setActivity("idle"));
        break;
      }
    }
  });

  pi.on("session_switch", async (_event, ctx) => {
    restoreHookState(ctx);
    updateLspStatus();
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreHookState(ctx);
    updateLspStatus();
  });

  pi.on("session_fork", async (_event, ctx) => {
    restoreHookState(ctx);
    updateLspStatus();
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    clearIdleShutdownTimer();
    diagnosticsAbort?.abort();
    diagnosticsAbort = null;
    setActivity("idle");

    await shutdownManager();
    activeClients.clear();
    statusUpdateFn?.("lsp", undefined);
  });

  pi.on("tool_call", async (event, ctx) => {
    const input = (event.input && typeof event.input === "object")
      ? event.input as Record<string, unknown>
      : {};

    if (event.toolName === "lsp") {
      clearIdleShutdownTimer();
      const files = extractLspFiles(input);
      for (const file of files) {
        ensureActiveClientForFile(file, ctx.cwd);
      }
      return;
    }

    if (event.toolName !== "read" && event.toolName !== "write" && event.toolName !== "edit") return;

    clearIdleShutdownTimer();
    const filePath = typeof input.path === "string" ? input.path : undefined;
    if (!filePath) return;

    if (event.toolName === "write" || event.toolName === "edit") {
      const absolutePath = normalizeFilePath(filePath, ctx.cwd);
      pendingToolFileExists.set(absolutePath, fs.existsSync(absolutePath));
    }

    const absPath = ensureActiveClientForFile(filePath, ctx.cwd);
    if (!absPath) return;

    void getOrCreateManager(ctx.cwd).getClientsForFile(absPath).catch(() => {});
  });

  pi.on("agent_start", async () => {
    clearIdleShutdownTimer();
    diagnosticsAbort?.abort();
    diagnosticsAbort = null;
    setActivity("idle");
    touchedFiles.clear();
    pendingToolFileExists.clear();
  });

  function agentWasAborted(event: any): boolean {
    const messages = Array.isArray(event?.messages) ? event.messages : [];
    return messages.some((m: any) =>
      m &&
      typeof m === "object" &&
      (m as any).role === "assistant" &&
      (((m as any).stopReason === "aborted") || ((m as any).stopReason === "error"))
    );
  }

  pi.on("agent_end", async (event, ctx) => {
    try {
      if (hookMode !== "agent_end") return;

      if (agentWasAborted(event)) {
        // Don't run diagnostics on aborted/error runs.
        touchedFiles.clear();
        return;
      }

      if (touchedFiles.size === 0) return;
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

      const abort = new AbortController();
      diagnosticsAbort?.abort();
      diagnosticsAbort = abort;

      // Avoid showing a transient "working" state during agent-end diagnostics.
      const files = Array.from(touchedFiles.entries());
      touchedFiles.clear();

      try {
        const outputs: string[] = [];
        for (const [filePath, includeWarnings] of files) {
          if (shuttingDown || abort.signal.aborted) return;
          if (!ctx.isIdle() || ctx.hasPendingMessages()) {
            abort.abort();
            return;
          }

          const output = await collectDiagnostics(filePath, ctx, includeWarnings, true, false);
          if (abort.signal.aborted) return;
          if (output) outputs.push(output);

          if (analyzerEnabled && analyzerHookMode === "agent_end") {
            const analyzerOutput = await collectAnalyzerDiagnostics(filePath, ctx);
            if (abort.signal.aborted) return;
            if (analyzerOutput) outputs.push(analyzerOutput);
          }
        }

        if (shuttingDown || abort.signal.aborted) return;

        if (outputs.length) {
          pi.sendMessage({
            customType: "lsp-diagnostics",
            content: outputs.join("\n"),
            display: true,
          }, {
            triggerTurn: true,
            deliverAs: "followUp",
          });
        }
      } finally {
        if (diagnosticsAbort === abort) diagnosticsAbort = null;
        if (!shuttingDown) setActivity("idle");
      }
    } finally {
      if (!shuttingDown) scheduleIdleShutdown();
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;

    const filePath = event.input.path as string;
    if (!filePath) return;

    const manager = getOrCreateManager(ctx.cwd);
    const normalizedPath = normalizeFilePath(filePath, ctx.cwd);
    const existedBefore = pendingToolFileExists.get(normalizedPath) ?? true;
    pendingToolFileExists.delete(normalizedPath);

    let formatterMessage: string | undefined;
    if (shouldRunFormatterForTool(event.toolName)) {
      const formatted = await runFormatterForFile(normalizedPath, ctx.cwd);
      if (formatted.formatterId) {
        formatterMessage = buildFormatterMessage(
          ctx.cwd,
          normalizedPath,
          formatted.formatterId,
          formatted.changed,
          formatted.error,
        );
      }
    }

    let analyzerMessage: string | undefined;
    if (shouldRunAnalyzerForTool(event.toolName)) {
      const analyzed = await runAnalyzersForFile(normalizedPath, ctx.cwd);
      if (analyzed.analyzerId) {
        analyzerMessage = buildAnalyzerMessage(
          ctx.cwd,
          normalizedPath,
          analyzed.analyzerId,
          analyzed.findings.length,
          analyzed.findings,
          analyzed.error,
        );
      }
    }

    await manager.notifyWorkspaceFileEvent(
      normalizedPath,
      existedBefore ? FileChangeType.Changed : FileChangeType.Created,
    );

    if (isLspSettingsFile(normalizedPath, ctx.cwd)) {
      await manager.restartAllClients();
      activeClients.clear();
      restoreHookState(ctx);
      updateLspStatus();
    } else if (shouldReloadProjectConfig(normalizedPath, ctx.cwd)) {
      await manager.restartClientsForPath(normalizedPath);
    }

    const absPath = ensureActiveClientForFile(filePath, ctx.cwd);
    if (!absPath) return;

    await manager.openFile(absPath).catch(() => false);

    if (hookMode === "disabled") return;

    if (hookMode === "agent_end") {
      const includeWarnings = event.toolName === "write";
      const existing = touchedFiles.get(absPath) ?? false;
      touchedFiles.set(absPath, existing || includeWarnings);
      return;
    }

    const includeWarnings = event.toolName === "write";
    const output = await collectDiagnostics(absPath, ctx, includeWarnings, false);
    if (!output && !formatterMessage && !analyzerMessage) return;

    const extra = [formatterMessage, analyzerMessage, output].filter(Boolean).join("");
    return { content: [...event.content, { type: "text" as const, text: extra }] as Array<{ type: "text"; text: string }> };
  });
}
