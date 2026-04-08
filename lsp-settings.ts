import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { z } from "zod/v4";

const jsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown());
const envSchema = z.record(z.string(), z.string());
const pythonProviderSchema = z.enum(["pyright", "basedpyright", "ty"]);
const hookModeSchema = z.enum(["edit_write", "agent_end", "disabled"]);
const formatterHookModeSchema = z.enum(["write", "edit_write", "disabled"]);

const lspServerSettingsSchema = z.strictObject({
  disabled: z.boolean().optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: envSchema.optional(),
  rootMarkers: z.array(z.string().min(1)).optional(),
  initializationOptions: jsonObjectSchema.optional(),
  workspaceConfiguration: jsonObjectSchema.optional(),
});

const formatterSettingsSchema = z.strictObject({
  disabled: z.boolean().optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: envSchema.optional(),
  environment: envSchema.optional(),
  extensions: z.array(z.string().min(1)).optional(),
  rootMarkers: z.array(z.string().min(1)).optional(),
});

const lspSettingsSchema = z.object({
  lsp: z.object({
    enabled: z.boolean().optional(),
    hookMode: hookModeSchema.optional(),
    python: z.object({
      provider: pythonProviderSchema.optional(),
    }).passthrough().optional(),
    servers: z.record(z.string(), lspServerSettingsSchema).optional(),
  }).passthrough().optional(),
  formatter: z.object({
    enabled: z.boolean().optional(),
    hookMode: formatterHookModeSchema.optional(),
    formatters: z.record(z.string(), formatterSettingsSchema).optional(),
  }).passthrough().optional(),
}).passthrough();

export type LSPServerSettings = z.infer<typeof lspServerSettingsSchema>;
export type FormatterSettings = z.infer<typeof formatterSettingsSchema>;
export type PythonProvider = z.infer<typeof pythonProviderSchema>;
export type HookMode = z.infer<typeof hookModeSchema>;
export type FormatterHookMode = z.infer<typeof formatterHookModeSchema>;

export interface ResolvedLSPSettings {
  projectSettingsPath: string;
  globalSettingsPath: string;
  enabled: boolean;
  hookMode?: HookMode;
  pythonProvider: PythonProvider;
  servers: Record<string, LSPServerSettings>;
  formatterEnabled: boolean;
  formatterHookMode: FormatterHookMode;
  formatters: Record<string, FormatterSettings>;
}

interface LoadLspSettingsOptions {
  globalSettingsPath?: string;
  projectSettingsPath?: string;
}

function readSettingsFile(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const validated = lspSettingsSchema.safeParse(parsed);
    return validated.success ? validated.data : {};
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const previous = result[key];
    if (isPlainObject(previous) && isPlainObject(value)) {
      result[key] = deepMerge(previous, value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

function mergeRecordSettings<T extends Record<string, Record<string, unknown>>>(
  globalItems: T,
  projectItems: T,
): T {
  const merged: Record<string, Record<string, unknown>> = { ...globalItems };
  for (const [itemId, itemSettings] of Object.entries(projectItems)) {
    const previous = merged[itemId] ?? {};
    merged[itemId] = deepMerge(previous, itemSettings);
  }
  return merged as T;
}

export function getFormatterEnv(settings: FormatterSettings): Record<string, string> | undefined {
  if (!settings.env && !settings.environment) return undefined;
  return {
    ...(settings.environment ?? {}),
    ...(settings.env ?? {}),
  };
}

export function loadResolvedLspSettings(
  cwd: string,
  options: LoadLspSettingsOptions = {},
): ResolvedLSPSettings {
  const globalSettingsPath = options.globalSettingsPath ?? path.join(os.homedir(), ".pi", "agent", "settings.json");
  const projectSettingsPath = options.projectSettingsPath ?? path.join(cwd, ".pi", "settings.json");

  const globalSettings = readSettingsFile(globalSettingsPath);
  const projectSettings = readSettingsFile(projectSettingsPath);

  const globalServers = isPlainObject((globalSettings as { lsp?: { servers?: unknown } }).lsp?.servers)
    ? (globalSettings as { lsp?: { servers?: Record<string, LSPServerSettings> } }).lsp?.servers ?? {}
    : {};
  const projectServers = isPlainObject((projectSettings as { lsp?: { servers?: unknown } }).lsp?.servers)
    ? (projectSettings as { lsp?: { servers?: Record<string, LSPServerSettings> } }).lsp?.servers ?? {}
    : {};
  const globalFormatters = isPlainObject((globalSettings as { formatter?: { formatters?: unknown } }).formatter?.formatters)
    ? (globalSettings as { formatter?: { formatters?: Record<string, FormatterSettings> } }).formatter?.formatters ?? {}
    : {};
  const projectFormatters = isPlainObject((projectSettings as { formatter?: { formatters?: unknown } }).formatter?.formatters)
    ? (projectSettings as { formatter?: { formatters?: Record<string, FormatterSettings> } }).formatter?.formatters ?? {}
    : {};

  const servers = mergeRecordSettings(globalServers, projectServers);
  const formatters = mergeRecordSettings(globalFormatters, projectFormatters);

  const globalHookMode = (globalSettings as { lsp?: { hookMode?: HookMode } }).lsp?.hookMode;
  const projectHookMode = (projectSettings as { lsp?: { hookMode?: HookMode } }).lsp?.hookMode;
  const globalEnabled = (globalSettings as { lsp?: { enabled?: boolean } }).lsp?.enabled;
  const projectEnabled = (projectSettings as { lsp?: { enabled?: boolean } }).lsp?.enabled;
  const globalPythonProvider = (globalSettings as { lsp?: { python?: { provider?: PythonProvider } } }).lsp?.python?.provider;
  const projectPythonProvider = (projectSettings as { lsp?: { python?: { provider?: PythonProvider } } }).lsp?.python?.provider;
  const globalFormatterEnabled = (globalSettings as { formatter?: { enabled?: boolean } }).formatter?.enabled;
  const projectFormatterEnabled = (projectSettings as { formatter?: { enabled?: boolean } }).formatter?.enabled;
  const globalFormatterHookMode = (globalSettings as { formatter?: { hookMode?: FormatterHookMode } }).formatter?.hookMode;
  const projectFormatterHookMode = (projectSettings as { formatter?: { hookMode?: FormatterHookMode } }).formatter?.hookMode;

  return {
    globalSettingsPath,
    projectSettingsPath,
    enabled: projectEnabled ?? globalEnabled ?? true,
    hookMode: projectHookMode ?? globalHookMode,
    pythonProvider: projectPythonProvider ?? globalPythonProvider ?? "pyright",
    servers,
    formatterEnabled: projectFormatterEnabled ?? globalFormatterEnabled ?? true,
    formatterHookMode: projectFormatterHookMode ?? globalFormatterHookMode ?? "write",
    formatters,
  };
}
