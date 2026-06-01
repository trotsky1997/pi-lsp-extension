import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CommandService } from "../src/command-service.ts";
import {
	AstService,
	type AstLanguage,
	type AstPatternNode,
	type AstRegistry,
} from "../src/core/tree-sitter-wasm-core.ts";

const tempDirs: string[] = [];
const textEncoder = new TextEncoder();

function mockFn<TArgs extends unknown[], TResult>(
	implementation: (...args: TArgs) => TResult,
) {
	const calls: TArgs[] = [];
	const fn = (...args: TArgs): TResult => {
		calls.push(args);
		return implementation(...args);
	};
	return Object.assign(fn, { calls });
}

function byteLength(source: string): number {
	return textEncoder.encode(source).length;
}

async function withTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openlsp-cli-tree-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true });
	}
	delete process.env.OPENLSP_CONFIG_JSON;
});

test("CommandService uses tree-sitter fallback for markdown document symbols", async () => {
	const dir = await withTempDir();
	await fs.writeFile(
		path.join(dir, "README.md"),
		["# Guide", "", "## Install", "", "Use [Install](#install).", ""].join(
			"\n",
		),
	);
	process.env.OPENLSP_CONFIG_JSON = JSON.stringify({ lsp: { enabled: false } });

	const service = new CommandService();
	const result = await service.execute({
		command: "lsp",
		cwd: dir,
		filePath: "README.md",
		operation: "documentSymbol",
	});

	expect(result.status).toBe("ok");
	if (result.status === "ok") {
		expect(result.metadata.backend).toBe("tree-sitter");
		const data = result.data as { result: Array<{ name: string }> };
		expect(data.result.map((symbol) => symbol.name)).toContain("Guide");
	}
});

test("AstService loads query-backed TypeScript symbols", async () => {
	const dir = await withTempDir();
	const file = path.join(dir, "sample.ts");
	await fs.writeFile(
		file,
		[
			"export interface Widget {",
			"  name: string;",
			"}",
			"",
			"export interface Service {",
			"  widget: Widget;",
			"}",
			"",
		].join("\n"),
	);

	const service = new AstService();
	const symbols = service.getDocumentSymbols(file);

	expect(symbols.map((symbol) => symbol.name)).toEqual(["Widget", "Service"]);
	expect(symbols.every((symbol) => symbol.kind === 11)).toBe(true);
});

test("AstService exposes ast-grep style language registry and pattern AST", async () => {
	const dir = await withTempDir();
	const file = path.join(dir, "sample.ts");
	await fs.writeFile(file, "const answer = 42;\n");

	const service = new AstService();
	const languageIds = service.listLanguages().map((language) => language.id);
	expect(languageIds).toContain("typescript");
	const language = service.languageForPath(file);
	expect(language?.kindToId("lexical_declaration")).toBeNumber();
	expect(language?.fieldToId("name")).toBeNumber();

	const pattern = service.parsePattern(file, "const $A = 42;");
	expect(pattern?.kind).toBe("internal");
	expect(JSON.stringify(pattern)).toContain("A");

	const matches = service.findPattern(file, "const $A = 42;");
	expect(matches).toHaveLength(1);
	expect(matches[0]?.captures.A?.[0]?.text).toBe("answer");
});

test("AstDocument supports incremental edit and included-range parsing", async () => {
	const service = new AstService();
	const language = service.languageForPath("sample.ts");
	expect(language).toBeDefined();
	if (!language) return;

	const prefix = "// 😀\nconst ";
	const document = service.parseSource(language, `${prefix}answer = 42;\n`);
	expect(document?.root.kind).toBe("program");
	const startIndex = byteLength(prefix);
	expect(
		document?.edit({
			startIndex,
			oldEndIndex: startIndex + byteLength("answer"),
			newText: "result",
		}),
	).toBe(true);
	expect(document?.source).toBe(`${prefix}result = 42;\n`);
	expect(document?.findAll(service.parsePattern("sample.ts", "const $A = 42;")!).at(0)?.captures.A?.[0]?.text).toBe("result");

	const rangePrefix = "not valid 😀\n";
	const source = `${rangePrefix}const ranged = 42;\nnot valid`;
	const rangeStartIndex = byteLength(rangePrefix);
	const endIndex = rangeStartIndex + byteLength("const ranged = 42;\n");
	const ranged = service.parseIncludedRanges(language, source, [
		{ startIndex: rangeStartIndex, endIndex },
	]);
	expect(ranged?.root.kind).toBe("program");
	expect(ranged?.root.text).toContain("const ranged = 42");
});

test("AstService delegates to an injected registry mock", () => {
	const language: AstLanguage = {
		id: "typescript",
		extensions: [".ts"],
		language: {} as AstLanguage["language"],
		metaVarChar: "$",
		expandoChar: "$",
		preProcessPattern: mockFn((source: string) => source),
		kindToId: mockFn((kind: string) => (kind === "program" ? 1 : null)),
		fieldToId: mockFn((field: string) => (field === "name" ? 2 : null)),
	};
	const pattern: AstPatternNode = {
		kind: "meta",
		name: "A",
		children: [],
	};
	const listLanguages = mockFn(() => [language]);
	const languageForPath = mockFn(() => language);
	const supportsOperation = mockFn(() => true);
	const parseSource = mockFn(() => null);
	const parseIncludedRanges = mockFn(() => null);
	const parseFile = mockFn(() => null);
	const parsePattern = mockFn(() => pattern);
	const loadQuery = mockFn(() => null);
	const registry: AstRegistry = {
		listLanguages,
		languageForPath,
		supportsOperation,
		parseSource,
		parseIncludedRanges,
		parseFile,
		parsePattern,
		loadQuery,
	};

	const service = new AstService(registry);

	expect(service.supportsOperation("sample.ts", "diagnostics")).toBe(true);
	expect(service.listLanguages()).toEqual([language]);
	expect(service.languageForPath("sample.ts")).toBe(language);
	expect(service.parsePattern("sample.ts", "const $A = 1;")).toBe(pattern);
	expect(service.parseSource(language, "const answer = 1;")).toBeNull();
	expect(
		service.parseIncludedRanges(language, "const answer = 1;", [
			{ startIndex: 0, endIndex: byteLength("const answer = 1;") },
		]),
	).toBeNull();

	expect(supportsOperation.calls).toEqual([["sample.ts", "diagnostics"]]);
	expect(parsePattern.calls).toEqual([[language, "const $A = 1;"]]);
	expect(parseSource.calls).toEqual([
		[language, "const answer = 1;", undefined],
	]);
	expect(parseIncludedRanges.calls).toHaveLength(1);
});
