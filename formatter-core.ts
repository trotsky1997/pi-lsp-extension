import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getFormatterEnv, loadResolvedLspSettings, type FormatterSettings } from "./lsp-settings.js";

interface FormatterCommand {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

interface FormatterConfig {
  id: string;
  extensions: string[];
  rootMarkers?: string[];
  resolveCommand: (filePath: string, cwd: string, settings: FormatterSettings) => FormatterCommand | undefined;
}

export interface FormatterRunResult {
  formatterId?: string;
  changed: boolean;
  skipped?: string;
  error?: string;
}

const SEARCH_PATHS = [
  ...(process.env.PATH?.split(path.delimiter) || []),
  "/usr/local/bin",
  "/opt/homebrew/bin",
  `${process.env.HOME}/.local/bin`,
  `${process.env.HOME}/.cargo/bin`,
  `${process.env.HOME}/go/bin`,
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

function findRoot(filePath: string, cwd: string, markers: string[]): string | undefined {
  const match = findNearestFile(path.dirname(filePath), markers, cwd);
  return match ? path.dirname(match) : undefined;
}

function resolveNodeBinary(root: string, binaryName: string): string | undefined {
  const local = path.join(root, "node_modules", ".bin", binaryName);
  if (fs.existsSync(local)) return local;
  return which(binaryName);
}

function formatterCwd(filePath: string, cwd: string, settings: FormatterSettings, fallbackMarkers: string[] = []): string {
  const markers = settings.rootMarkers && settings.rootMarkers.length > 0 ? settings.rootMarkers : fallbackMarkers;
  return markers.length > 0 ? (findRoot(filePath, cwd, markers) ?? cwd) : cwd;
}

function buildFormatterEnv(settings: FormatterSettings): Record<string, string> | undefined {
  const env = getFormatterEnv(settings);
  return env ? { ...process.env, ...env } as Record<string, string> : undefined;
}

function configuredFormatterCommand(
  filePath: string,
  cwd: string,
  settings: FormatterSettings,
  defaultCommand: (root: string) => string | undefined,
  defaultArgs: (file: string) => string[],
  fallbackMarkers: string[] = [],
): FormatterCommand | undefined {
  if (settings.disabled) return undefined;

  const root = formatterCwd(filePath, cwd, settings, fallbackMarkers);
  const command = settings.command ?? defaultCommand(root);
  if (!command) return undefined;

  return {
    command,
    args: settings.args ?? defaultArgs(filePath),
    cwd: root,
    env: buildFormatterEnv(settings),
  };
}

function directBinaryFormatter(
  id: string,
  extensions: string[],
  binaryName: string,
  defaultArgs: (file: string) => string[],
  rootMarkers: string[] = [],
): FormatterConfig {
  return {
    id,
    extensions,
    rootMarkers,
    resolveCommand: (filePath, cwd, settings) => configuredFormatterCommand(
      filePath,
      cwd,
      settings,
      () => which(binaryName),
      defaultArgs,
      rootMarkers,
    ),
  };
}

function nodeBinaryFormatter(
  id: string,
  extensions: string[],
  binaryName: string,
  defaultArgs: (file: string) => string[],
  rootMarkers: string[] = ["package.json"],
): FormatterConfig {
  return {
    id,
    extensions,
    rootMarkers,
    resolveCommand: (filePath, cwd, settings) => configuredFormatterCommand(
      filePath,
      cwd,
      settings,
      (root) => resolveNodeBinary(root, binaryName),
      defaultArgs,
      rootMarkers,
    ),
  };
}

const JS_LIKE_EXTENSIONS = [
  ".js", ".jsx", ".cjs", ".mjs", ".ts", ".tsx", ".cts", ".mts",
  ".json", ".jsonc", ".css", ".scss", ".less", ".html", ".md", ".mdx",
  ".yaml", ".yml", ".vue", ".svelte", ".astro", ".graphql",
];

export const FORMATTERS: FormatterConfig[] = [
  nodeBinaryFormatter("biome", JS_LIKE_EXTENSIONS, "biome", (file) => ["format", "--write", file], ["biome.json", "biome.jsonc", "package.json"]),
  nodeBinaryFormatter("prettier", JS_LIKE_EXTENSIONS, "prettier", (file) => ["--write", file], ["package.json", ".prettierrc", ".prettierrc.json", "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs"]),
  directBinaryFormatter("ruff", [".py", ".pyi"], "ruff", (file) => ["format", file], ["pyproject.toml", "ruff.toml"]),
  directBinaryFormatter("uv", [".py", ".pyi"], "uv", (file) => ["tool", "run", "ruff", "format", file], ["pyproject.toml", "uv.lock"]),
  directBinaryFormatter("gofmt", [".go"], "gofmt", (file) => ["-w", file], ["go.mod", "go.work"]),
  directBinaryFormatter("rustfmt", [".rs"], "rustfmt", (file) => [file], ["Cargo.toml", "rustfmt.toml"]),
  directBinaryFormatter("clang-format", [".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".m", ".mm", ".java"], "clang-format", (file) => ["-i", file]),
  directBinaryFormatter("shfmt", [".sh", ".bash", ".zsh"], "shfmt", (file) => ["-w", file]),
  directBinaryFormatter("dart", [".dart"], "dart", (file) => ["format", file], ["pubspec.yaml"]),
  directBinaryFormatter("terraform", [".tf", ".tfvars", ".hcl"], "terraform", (file) => ["fmt", file], [".terraform", "terraform.tf", "main.tf"]),
  directBinaryFormatter("ktlint", [".kt", ".kts"], "ktlint", (file) => ["--format", file], ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"]),
  directBinaryFormatter("mix", [".ex", ".exs"], "mix", (file) => ["format", file], ["mix.exs"]),
  directBinaryFormatter("ocamlformat", [".ml", ".mli"], "ocamlformat", (file) => ["-i", file], ["dune-project", ".ocamlformat"]),
  directBinaryFormatter("ormolu", [".hs", ".lhs"], "ormolu", (file) => ["--mode", "inplace", file], ["stack.yaml", "cabal.project", "package.yaml"]),
  directBinaryFormatter("nixfmt", [".nix"], "nixfmt", (file) => [file]),
  directBinaryFormatter("pint", [".php"], "pint", (file) => [file], ["composer.json", "pint.json"]),
  directBinaryFormatter("rubocop", [".rb", ".rake"], "rubocop", (file) => ["-A", file], ["Gemfile", ".rubocop.yml"]),
  directBinaryFormatter("standardrb", [".rb", ".rake"], "standardrb", (file) => ["--fix", file], ["Gemfile", ".standard.yml"]),
  directBinaryFormatter("zig", [".zig"], "zig", (file) => ["fmt", file]),
  directBinaryFormatter("cljfmt", [".clj", ".cljs", ".cljc", ".edn"], "cljfmt", (file) => ["fix", file], ["deps.edn", "project.clj"]),
  directBinaryFormatter("dfmt", [".d"], "dfmt", (file) => ["-i", file]),
  directBinaryFormatter("gleam", [".gleam"], "gleam", (file) => ["format", file], ["gleam.toml"]),
  directBinaryFormatter("htmlbeautifier", [".html", ".erb"], "htmlbeautifier", (file) => ["-w", file]),
  directBinaryFormatter("air", [".r"], "air", (file) => ["format", file]),
];

export function getFormatterConfigsForFile(filePath: string, cwd: string = process.cwd()): FormatterConfig[] {
  const ext = path.extname(filePath).toLowerCase();
  const settings = loadResolvedLspSettings(cwd);
  return FORMATTERS.filter((formatter) => {
    const overrides = settings.formatters[formatter.id];
    if (overrides?.disabled) return false;
    const extensions = overrides?.extensions ?? formatter.extensions;
    return extensions.includes(ext);
  });
}

function runCommand(command: FormatterCommand): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(command.command, command.args, {
        cwd: command.cwd,
        env: command.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    } catch (error) {
      reject(error);
    }
  });
}

export async function runFormatterForFile(filePath: string, cwd: string): Promise<FormatterRunResult> {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  if (!fs.existsSync(absPath)) return { changed: false, skipped: "file_missing" };

  const settings = loadResolvedLspSettings(cwd);
  if (!settings.formatterEnabled || settings.formatterHookMode === "disabled") {
    return { changed: false, skipped: "formatter_disabled" };
  }

  const candidates = getFormatterConfigsForFile(absPath, cwd);
  if (candidates.length === 0) return { changed: false, skipped: "no_match" };

  const before = fs.readFileSync(absPath, "utf-8");

  for (const formatter of candidates) {
    const command = formatter.resolveCommand(absPath, cwd, settings.formatters[formatter.id] ?? {});
    if (!command) continue;

    try {
      const result = await runCommand(command);
      if (result.code !== 0) {
        return {
          formatterId: formatter.id,
          changed: false,
          error: result.signal ? `formatter exited via signal ${result.signal}` : `formatter exited with code ${result.code}`,
        };
      }
      const after = fs.readFileSync(absPath, "utf-8");
      return {
        formatterId: formatter.id,
        changed: before !== after,
      };
    } catch (error) {
      return {
        formatterId: formatter.id,
        changed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { changed: false, skipped: "unavailable" };
}
