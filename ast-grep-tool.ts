import { spawn, spawnSync } from "node:child_process";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ast-grep language aliases by file extension. Only the common ones; ast-grep
// auto-detects from extension when --lang is omitted, so this is just a hint for
// callers that pass a single file path without a recognizable extension.
const LANG_BY_EXT: Record<string, string> = {
	".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
	".ts": "TypeScript", ".tsx": "Tsx", ".cts": "TypeScript", ".mts": "TypeScript",
	".py": "Python", ".pyi": "Python",
	".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "Php",
	".java": "Java", ".kt": "Kotlin", ".swift": "Swift", ".scala": "Scala",
	".lua": "Lua", ".ex": "Elixir", ".exs": "Elixir",
	".html": "Html", ".css": "Css", ".json": "Json", ".yml": "Yaml", ".yaml": "Yaml",
	".c": "C", ".h": "C", ".cpp": "Cpp", ".cc": "Cpp", ".cxx": "Cpp", ".hpp": "Cpp",
	".cs": "CSharp", ".sol": "Solidity", ".nix": "Nix",
};

const STRICTNESS = ["cst", "smart", "ast", "relaxed", "signature", "template"] as const;

const AstGrepParams = Type.Object({
	pattern: Type.String({
		description: "AST pattern to match. Write ordinary code; use $UPPER (e.g. $A, $MATCH) as a wildcard matching any single AST node. Example: console.log($A)",
	}),
	paths: Type.Optional(Type.Array(Type.String(), {
		description: "Files or directories to search. Defaults to the current working directory.",
	})),
	lang: Type.Optional(Type.String({
		description: "ast-grep language alias (e.g. JavaScript, Tsx, Python, Go). If omitted, inferred from the first path's extension.",
	})),
	rewrite: Type.Optional(Type.String({
		description: "If set, rewrite each match to this template (may reference $A/$MATCH) and update files in place. Returns a change summary instead of matches.",
	})),
	strictness: Type.Optional(StringEnum(STRICTNESS, {
		description: "Match granularity. Default 'smart' (all nodes except trivial source). 'ast' ignores comments/whitespace; 'signature' ignores text.",
	})),
});

interface AstGrepMatch {
	text: string;
	file: string;
	range: { start: { line: number; column: number }; end: { line: number; column: number } };
	language: string;
	lines: string;
	metaVariables?: { single?: Record<string, { text: string }> };
}

function buildArgs(params: any, lang: string | undefined, cwd: string): string[] {
	const isRewrite = !!params.rewrite;
	// --json conflicts with --update-all: with --json, ast-grep runs dry-run and
	// only emits replacement fields without writing. For rewrites, omit --json so
	// --update-all actually mutates files.
	const args = isRewrite ? ["run", "-p", params.pattern] : ["run", "--json=compact", "-p", params.pattern];
	if (lang) args.push("-l", lang);
	if (params.strictness) args.push("--strictness", params.strictness);
	if (isRewrite) args.push("-r", params.rewrite, "--update-all");
	const paths = Array.isArray(params.paths) && params.paths.length ? params.paths : [cwd];
	for (const p of paths) args.push(path.isAbsolute(p) ? p : path.resolve(cwd, p));
	return args;
}

function findAstGrep(): string | undefined {
	// ponytail: rely on PATH; ast-grep ships `ast-grep` and `sg` shims.
	for (const b of ["ast-grep", "sg"]) {
		try {
			const r = spawnSync(b, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
			if (r.status === 0 || r.stdout) return b;
		} catch {}
	}
	return undefined;
}

function runAstGrep(bin: string, args: string[], cwd: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve) => {
		const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => (stdout += c.toString("utf-8")));
		child.stderr.on("data", (c) => (stderr += c.toString("utf-8")));
		const onAbort = () => { try { child.kill("SIGTERM"); } catch {} };
		signal?.addEventListener("abort", onAbort, { once: true });
		child.on("close", (code) => { signal?.removeEventListener("abort", onAbort); resolve({ stdout, stderr, code }); });
		child.on("error", (e) => { signal?.removeEventListener("abort", onAbort); resolve({ stdout, stderr: stderr + String(e), code: -1 }); });
	});
}

function inferLang(params: any): string | undefined {
	if (params.lang) return params.lang;
	const paths: string[] = Array.isArray(params.paths) ? params.paths : [];
	for (const p of paths) {
		const ext = path.extname(p).toLowerCase();
		if (ext && LANG_BY_EXT[ext]) return LANG_BY_EXT[ext];
	}
	return undefined;
}

function formatMatches(matches: AstGrepMatch[], cwd: string): string {
	if (!matches.length) return "No matches.";
	const byFile = new Map<string, AstGrepMatch[]>();
	for (const m of matches) {
		const rel = path.relative(cwd, m.file) || m.file;
		if (!byFile.has(rel)) byFile.set(rel, []);
		byFile.get(rel)!.push(m);
	}
	const lines: string[] = [];
	let shown = 0;
	const MAX = 50;
	for (const [file, fileMatches] of byFile) {
		if (shown >= MAX) break;
		lines.push(`${file} (${fileMatches.length})`);
		for (const m of fileMatches) {
			if (shown >= MAX) { lines.push(`  ... (${matches.length - shown} more)`); break; }
			const meta = m.metaVariables?.single
				? Object.entries(m.metaVariables.single).map(([k, v]) => `${k}=${v.text}`).join(", ")
				: "";
			lines.push(`  ${m.range.start.line + 1}:${m.range.start.column + 1}  ${m.text}${meta ? `  [${meta}]` : ""}`);
			shown++;
		}
	}
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ast-grep",
		label: "ast-grep",
		description: `Structural code search and rewrite via ast-grep. Match code by AST pattern, not text: the pattern is ordinary code with $UPPER wildcards (e.g. $A) that match any single AST node.

Use for: finding call sites, detecting code smells, batch-rewriting idioms (e.g. console.log($A) -> logger.info($A)). Complements lsp: lsp gives semantic resolution, ast-grep gives syntactic matching and in-place rewriting.

Examples: pattern "console.log($A)" finds all calls; pattern "$A == null" with rewrite "$A === null" batch-fixes loose equality.`,
		parameters: AstGrepParams,

		async execute(_id: unknown, rawParams: unknown, _onUpdate: unknown, ctxArg: unknown, signalArg: unknown): Promise<any> {
			const ctx = (typeof ctxArg === "object" && ctxArg && "cwd" in ctxArg) ? ctxArg as { cwd: string } : { cwd: process.cwd() };
			const signal = (signalArg && typeof signalArg === "object" && "aborted" in signalArg) ? signalArg as AbortSignal : undefined;
			const params = rawParams as any;
			if (!params?.pattern) return { content: [{ type: "text" as const, text: "Missing required parameter: pattern" }], details: { error: "missing_pattern" } };

			const bin = findAstGrep();
			if (!bin) return { content: [{ type: "text" as const, text: "ast-grep binary not found on PATH. Install: npm i -g @ast-grep/cli or cargo install ast-grep" }], details: { error: "binary_not_found" } };

			const lang = inferLang(params);
			const args = buildArgs(params, lang, ctx.cwd);
			const { stdout, stderr, code } = await runAstGrep(bin, args, ctx.cwd, signal);

			// ast-grep exits non-zero when no matches are found (exit 1). Treat empty result as success.
			if (code === -1) {
				return { content: [{ type: "text" as const, text: `ast-grep failed to spawn: ${stderr.trim()}` }], details: { error: "spawn_failed", stderr } };
			}

			const isRewrite = !!params.rewrite;
			if (isRewrite) {
				// Without --json, ast-grep prints 'Applied N changes' to stdout and writes files.
				const appliedMatch = stdout.match(/Applied\s+(\d+)\s+changes?/i);
				const count = appliedMatch ? parseInt(appliedMatch[1], 10) : undefined;
				const msg = stderr.trim()
					? `Rewrote matches in place. ${count !== undefined ? `${count} changes. ` : ""}${stderr.trim()}`
					: count !== undefined ? `Rewrote ${count} match${count === 1 ? "" : "es"} in place.` : "Rewrote matches in place.";
				return { content: [{ type: "text" as const, text: msg }], details: { operation: "rewrite", pattern: params.pattern, rewrite: params.rewrite, changeCount: count } };
			}

			// ast-grep exits non-zero when no matches found; stdout is then empty.
			if (!stdout.trim()) {
				return { content: [{ type: "text" as const, text: "No matches." }], details: { operation: "search", pattern: params.pattern, lang, matchCount: 0, fileCount: 0 } };
			}


			let matches: AstGrepMatch[] = [];
			try { matches = JSON.parse(stdout); } catch {
				return { content: [{ type: "text" as const, text: `ast-grep produced non-JSON output:\n${stdout.slice(0, 500)}` }], details: { error: "parse_error", stdout, stderr } };
			}
			const text = formatMatches(matches, ctx.cwd);
			return {
				content: [{ type: "text" as const, text }],
				details: { operation: "search", pattern: params.pattern, lang, matchCount: matches.length, fileCount: new Set(matches.map((m) => m.file)).size },
			};
		},
	});
}
