import * as fs from "node:fs";
import * as path from "node:path";
import type { Hover } from "vscode-languageserver-protocol";

interface DevDocsEntry {
  name: string;
  path: string;
  type?: string;
}

type FetchLike = typeof fetch;

const MAX_READ_BYTES = 64 * 1024;
const docsetCache = new Map<string, Promise<DevDocsEntry[]>>();

function normalizeSymbol(value: string): string {
  return value.trim().replace(/\(\)$/, "").toLowerCase();
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

  const chainPattern = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g;
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

export function selectDevDocsDocsets(filePath: string): string[] {
  switch (path.extname(filePath).toLowerCase()) {
    case ".ts":
    case ".tsx":
    case ".cts":
    case ".mts":
      return ["typescript", "javascript"];
    case ".js":
    case ".jsx":
    case ".cjs":
    case ".mjs":
      return ["javascript"];
    case ".py":
    case ".pyi":
      return ["python~3.14"];
    default:
      return [];
  }
}

function devDocsIndexUrl(docset: string): string {
  return `https://devdocs.io/docs/${docset}/index.json`;
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

  for (const docset of selectDevDocsDocsets(filePath)) {
    try {
      const entry = findBestDevDocsEntry(await loadDocsetIndex(docset, fetchImpl), symbol);
      if (entry) return devDocsHover(docset, entry);
    } catch {
      // Ignore network and parsing failures so hover fallback stays best-effort.
    }
  }

  return null;
}

export function resetDevDocsCache(): void {
  docsetCache.clear();
}
