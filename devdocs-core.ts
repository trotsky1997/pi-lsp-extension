import * as fs from "node:fs";
import * as path from "node:path";
import type { Hover } from "vscode-languageserver-protocol";
import { detectLanguage } from "./language-detect.js";

interface DevDocsEntry {
  name: string;
  path: string;
  type?: string;
}

type FetchLike = typeof fetch;

const MAX_READ_BYTES = 64 * 1024;
const docsetCache = new Map<string, Promise<DevDocsEntry[]>>();

// A resolved docset from the catalog: its full slug (with version) plus the
// import alias devdocs publishes for it (e.g. numpy -> "np"). alias is null
// when the docset has none.
interface CatalogDocset {
  slug: string;
  alias: string | null;
}

let catalogPromise: Promise<Map<string, CatalogDocset>> | null = null;

function normalizeSymbol(value: string): string {
  return value.trim().replace(/\(\)$/, "").toLowerCase();
}

// Compare version strings as semver-ish tuples ("3.14" vs "3.9"). Numeric
// segments compared numerically so 3.9 < 3.14 (not lexicographic where 3.9 > 3.14).
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// The catalog lists every docset with its slug, version, and alias. We cache a
// map from base name (slug without ~version) to the highest-version docset so
// callers never hardcode versions. https://devdocs.io/docs/docs.json is the SPA
// catalog endpoint (returns real JSON, ~360KB).
function loadCatalog(fetchImpl: FetchLike): Promise<Map<string, CatalogDocset>> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    const map = new Map<string, CatalogDocset>();
    try {
      const res = await fetchImpl("https://devdocs.io/docs/docs.json");
      if (!res.ok) return map;
      const list = (await res.json()) as Array<{
        slug: string;
        version?: string;
        alias?: string | null;
      }>;
      for (const item of list) {
        const base = item.slug.split("~")[0];
        if (!base) continue;
        const existing = map.get(base);
        if (!existing || (item.version && compareVersions(item.version, existing.slug.split("~")[1] ?? "") > 0)) {
          map.set(base, { slug: item.slug, alias: item.alias ?? null });
        }
      }
    } catch {
      // Network/catalog failure: leave empty; callers fall back to hardcoded slugs.
    }
    return map;
  })();
  catalogPromise.catch(() => { catalogPromise = null; }); // allow retry on failure
  return catalogPromise;
}

export function resetDevDocsCache(): void {
  docsetCache.clear();
  catalogPromise = null;
}

// Map a detected language name (from linguist via language-detect) to the
// devdocs base names whose indexes should be searched. The primary language
// is first; ecosystem libraries (numpy/pandas for python, lodash for js) follow
// since one file may use either. Base names resolve to the latest versioned
// slug via the catalog, so this table never needs version pins.
const LANGUAGE_TO_DOCSETS: Record<string, string[]> = {
  python: ["python", "numpy", "pandas", "scipy", "django", "flask"],
  typescript: ["typescript", "javascript", "node", "lodash"],
  javascript: ["javascript", "node", "lodash", "jquery"],
  rust: ["rust"],
  go: ["go"],
  c: ["c"],
  cpp: ["cpp"],
  ruby: ["ruby"],
  php: ["php"],
  kotlin: ["kotlin"],
  swift: ["swift"],
  elixir: ["elixir"],
  lua: ["lua"],
  haskell: ["haskell"],
  shell: ["bash"],
  bash: ["bash"],
  css: ["css"],
  html: ["html"],
};

// Detect the file's language (via linguist: extension + shebang + content
// heuristics) and return the devdocs base names to search. Async because
// linguist analyseRawContent is async.
export async function selectDevDocsDocsets(filePath: string, content?: string): Promise<string[]> {
  const lang = await detectLanguage(filePath, content);
  if (!lang) return [];
  return LANGUAGE_TO_DOCSETS[lang] ?? [];
}

// Hardcoded fallback slugs used only if the catalog can't be loaded (offline).
const FALLBACK_SLUGS: Record<string, string> = {
  python: "python~3.14", numpy: "numpy~2.4", pandas: "pandas~3",
  typescript: "typescript", javascript: "javascript", node: "node~22",
  lodash: "lodash~4", jquery: "jquery", react: "react",
  rust: "rust", go: "go", c: "c", cpp: "cpp", ruby: "ruby~4.0", php: "php",
  kotlin: "kotlin~1.9", swift: "swift", elixir: "elixir~1.20", lua: "lua~5.5",
  haskell: "haskell~9", bash: "bash", css: "css", html: "html",
  django: "django~6.1", flask: "flask", scipy: "scipy",
};

// Returns the fully-versioned slug for a base name, preferring the catalog's
// latest version and falling back to a pinned slug if the catalog is offline.
async function resolveDocsetSlug(base: string, fetchImpl: FetchLike): Promise<string | null> {
  const catalog = await loadCatalog(fetchImpl);
  const entry = catalog.get(base);
  if (entry) return entry.slug;
  const fallback = FALLBACK_SLUGS[base];
  return fallback ?? null;
}

async function resolveDocsetAlias(base: string, fetchImpl: FetchLike): Promise<string | null> {
  const catalog = await loadCatalog(fetchImpl);
  return catalog.get(base)?.alias ?? null;
}

function readLineAtPosition(filePath: string, line: number): string | null {
  try {
    const absolutePath = path.resolve(filePath);
    const fd = fs.openSync(absolutePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(MAX_READ_BYTES);
      const bytesRead = fs.readSync(fd, buffer, 0, MAX_READ_BYTES, 0);
      const content = buffer.toString("utf-8", 0, bytesRead);
      const lines = content.split("\n");
      if (line < 0 || line >= lines.length) return null;
      if (bytesRead === MAX_READ_BYTES && line === lines.length - 1) return null;
      return lines[line] ?? null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

export function extractDevDocsSymbolAtPosition(filePath: string, line: number, character: number): string | null {
  const lineContent = readLineAtPosition(filePath, line);
  if (!lineContent || character < 0 || character >= lineContent.length) return null;

  // Match dotted or ::-separated symbol chains (os.path.join, Vec::new,
  // std::vec::Vec) so Rust/C++ path syntax is extracted as one symbol.
  const chainPattern = /[A-Za-z_$][\w$]*(?:(?:\.|::)[A-Za-z_$][\w$]*)*/g;
  let match: RegExpExecArray | null;
  while ((match = chainPattern.exec(lineContent)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (character >= start && character < end) return match[0] ?? null;
  }

  const symbolPattern = /[A-Za-z_$][\w$]*/g;
  while ((match = symbolPattern.exec(lineContent)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (character >= start && character < end) return match[0] ?? null;
  }

  return null;
}

function devDocsIndexUrl(docset: string): string {
  // The SPA at devdocs.io serves HTML for /<docset>/index.json. The actual
  // index.json lives on the documents.devdocs.io CDN (app config docs_origin).
  return `https://documents.devdocs.io/${docset}/index.json`;
}

function devDocsEntryUrl(docset: string, entry: DevDocsEntry): string {
  return `https://devdocs.io/${docset}/${entry.path}`;
}

async function loadDocsetIndex(docset: string, fetchImpl: FetchLike): Promise<DevDocsEntry[]> {
  const cached = docsetCache.get(docset);
  if (cached) return cached;

  const pending = (async () => {
    const response = await fetchImpl(devDocsIndexUrl(docset));
    if (!response.ok) throw new Error(`DevDocs index request failed for ${docset}: ${response.status}`);
    const payload = await response.json() as { entries?: DevDocsEntry[] };
    return Array.isArray(payload.entries) ? payload.entries : [];
  })();

  docsetCache.set(docset, pending);
  try {
    return await pending;
  } catch (error) {
    docsetCache.delete(docset);
    throw error;
  }
}

// Map an import alias to the docset's canonical module prefix using the alias
// the catalog publishes (numpy -> "np"). When the symbol already uses the full
// name (numpy.array) or the docset has no alias, return it unchanged.
async function canonicalizeSymbol(base: string, symbol: string, fetchImpl: FetchLike): Promise<string> {
  const alias = await resolveDocsetAlias(base, fetchImpl);
  if (!alias) return symbol;
  const dot = symbol.indexOf(".");
  if (dot <= 0) return symbol;
  const head = symbol.slice(0, dot);
  const rest = symbol.slice(dot);
  return head === alias ? `${base}${rest}` : symbol;
}

function scoreDevDocsEntry(entry: DevDocsEntry, query: string): number {
  const normalizedName = normalizeSymbol(entry.name);
  if (normalizedName === query) return 0;
  if (normalizedName.endsWith(`.${query}`)) return 1;
  if (normalizedName.includes(query)) return 2;
  return Number.POSITIVE_INFINITY;
}

export function findBestDevDocsEntry(entries: DevDocsEntry[], symbol: string): DevDocsEntry | null {
  const query = normalizeSymbol(symbol);
  const ranked = entries
    .map((entry) => ({ entry, score: scoreDevDocsEntry(entry, query) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score || left.entry.name.length - right.entry.name.length);

  return ranked[0]?.entry ?? null;
}

function devDocsHover(docset: string, entry: DevDocsEntry): Hover {
  const type = entry.type ? ` (${entry.type})` : "";
  const url = devDocsEntryUrl(docset, entry);
  return {
    contents: {
      kind: "markdown",
      value: [
        "Documentation provider: DevDocs",
        "",
        `**${entry.name}**${type}`,
        "",
        `[Open docs](${url})`,
      ].join("\n"),
    },
  };
}

export async function getDevDocsHover(
  filePath: string,
  line: number,
  character: number,
  fetchImpl: FetchLike = fetch,
): Promise<Hover | null> {
  const symbol = extractDevDocsSymbolAtPosition(filePath, line - 1, character - 1);
  if (!symbol) return null;

  for (const base of await selectDevDocsDocsets(filePath)) {
    try {
      const slug = await resolveDocsetSlug(base, fetchImpl);
      if (!slug) continue;
      const entries = await loadDocsetIndex(slug, fetchImpl);
      const candidate = await canonicalizeSymbol(base, symbol, fetchImpl);
      const entry = findBestDevDocsEntry(entries, candidate);
      if (entry) return devDocsHover(slug, entry);
    } catch {
      // Ignore network and parsing failures so hover fallback stays best-effort.
    }
  }

  return null;
}
