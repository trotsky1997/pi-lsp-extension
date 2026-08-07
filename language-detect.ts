import * as fs from "node:fs";
import * as path from "node:path";
import linguist from "linguist-js";

// Single source of truth for "what language is this file" across the extension.
// Wraps linguist-js (GitHub's heuristics: extension + filename + shebang +
// content) so callers stop hand-rolling path.extname switches. Results are
// cached per file mtime to avoid re-analysing on every hover.

// linguist returns display names ("C++", "JavaScript"); map to the lowercase
// identifiers the rest of the extension uses (cpp, javascript) and to the
// devdocs base name where it differs.
const NAME_TO_BASE: Record<string, string> = {
	"C++": "cpp",
	"C#": "csharp",
	"Objective-C++": "objective_cpp",
	"Objective-C": "objective_c",
	"Emacs Lisp": "emacs_lisp",
	"Common Lisp": "lisp",
	"Visual Basic .NET": "vbnet",
	"Visual Basic": "vb",
	"ActionScript 3.0": "actionscript",
	"ObjectScript": "objectscript",
	"Batchfile": "batch",
	"Shell": "bash",
	"Nano": "nano",
};

function nameToBase(displayName: string): string {
	if (NAME_TO_BASE[displayName]) return NAME_TO_BASE[displayName];
	return displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const cache = new Map<string, { mtime: number; lang: string | null }>();

function readCached(filePath: string): string | null {
	try {
		const stat = fs.statSync(filePath);
		const key = path.resolve(filePath);
		const cached = cache.get(key);
		if (cached && cached.mtime === stat.mtimeMs) return cached.lang;
		return null; // caller must populate
	} catch {
		return null;
	}
}

function writeCache(filePath: string, lang: string | null) {
	try {
		const stat = fs.statSync(filePath);
		cache.set(path.resolve(filePath), { mtime: stat.mtimeMs, lang });
	} catch {
		// ignore — cache is best-effort
	}
}

// Detect the language of a file. Uses linguist-js, which inspects the filename
// (extension + full name), shebang, and content heuristics. Returns a lowercase
// base name (e.g. "python", "rust", "cpp", "javascript") or null if no language
// is detected (binary, prose-only, unknown). content, if already read by the
// caller, can be passed to skip a redundant read.
export async function detectLanguage(
	filePath: string,
	content?: string,
): Promise<string | null> {
	const cached = readCached(filePath);
	if (cached !== null) return cached;

	try {
		const text = content ?? fs.readFileSync(filePath, "utf-8");
		const filename = path.basename(filePath);
		const result = await linguist.analyseRawContent({ [filename]: text }, { offline: true });
		const detected = result.files.results[filename];
		const lang = detected ? nameToBase(detected) : null;
		writeCache(filePath, lang);
		return lang;
	} catch {
		return null;
	}
}

// Synchronous best-effort fallback: if a caller cannot await (e.g. a sync
// supportsOperation path), fall back to the extension mapping. This is weaker
// than detectLanguage (no content shebang/heuristics) but cheap and offline.
const EXT_FALLBACK: Record<string, string> = {
	".py": "python", ".pyi": "python",
	".ts": "typescript", ".tsx": "typescript", ".cts": "typescript", ".mts": "typescript",
	".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
	".rs": "rust", ".go": "go", ".rb": "ruby", ".php": "php",
	".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp",
	".cs": "csharp", ".kt": "kotlin", ".kts": "kotlin", ".swift": "swift",
	".ex": "elixir", ".exs": "elixir", ".lua": "lua", ".hs": "haskell",
	".sh": "bash", ".bash": "bash", ".zsh": "bash",
	".css": "css", ".html": "html", ".htm": "html",
	".java": "java", ".scala": "scala", ".sol": "solidity",
	".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
	".md": "markdown", ".mdx": "markdown",
};

export function detectLanguageSync(filePath: string): string | null {
	const cached = readCached(filePath);
	if (cached !== null) return cached;
	return EXT_FALLBACK[path.extname(filePath).toLowerCase()] ?? null;
}

export function clearLanguageCache(): void {
	cache.clear();
}
