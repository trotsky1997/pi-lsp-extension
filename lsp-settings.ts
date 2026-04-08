import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { z } from "zod/v4";

const jsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown());

const lspServerSettingsSchema = z.strictObject({
  disabled: z.boolean().optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  rootMarkers: z.array(z.string().min(1)).optional(),
  initializationOptions: jsonObjectSchema.optional(),
  workspaceConfiguration: jsonObjectSchema.optional(),
});

const lspSettingsSchema = z.object({
  lsp: z.object({
    servers: z.record(z.string(), lspServerSettingsSchema).optional(),
  }).passthrough().optional(),
}).passthrough();

export type LSPServerSettings = z.infer<typeof lspServerSettingsSchema>;
export interface ResolvedLSPSettings {
  projectSettingsPath: string;
  servers: Record<string, LSPServerSettings>;
  globalSettingsPath: string;
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

  const servers: Record<string, LSPServerSettings> = { ...globalServers };
  for (const [serverId, serverSettings] of Object.entries(projectServers)) {
    const previous = servers[serverId] ?? {};
    servers[serverId] = deepMerge(previous, serverSettings);
  }

  return {
    globalSettingsPath,
    projectSettingsPath,
    servers,
  };
}
