import TreeSitter from "@vscode/tree-sitter-wasm";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	DiagnosticSeverity,
	DocumentHighlightKind,
	SymbolKind,
	type Diagnostic,
	type DocumentHighlight,
	type DocumentSymbol,
	type FoldingRange,
	type Hover,
	type Location,
	type SymbolInformation,
} from "vscode-languageserver-protocol";

export type TreeSitterOperation =
	| "diagnostics"
	| "goToDefinition"
	| "findReferences"
	| "hover"
	| "documentSymbol"
	| "workspaceSymbol"
	| "documentHighlight"
	| "foldingRange";

type WasmParser = InstanceType<typeof TreeSitter.Parser>;
type WasmLanguage = InstanceType<typeof TreeSitter.Language>;
type WasmTree = InstanceType<typeof TreeSitter.Tree>;
type WasmNode = InstanceType<typeof TreeSitter.Node>;
type WasmQuery = InstanceType<typeof TreeSitter.Query>;
type WasmPoint = { row: number; column: number };

export type SupportedLanguageId =
	| "bash"
	| "csharp"
	| "cpp"
	| "css"
	| "go"
	| "ini"
	| "java"
	| "javascript"
	| "php"
	| "powershell"
	| "typescript"
	| "tsx"
	| "python"
	| "regex"
	| "ruby"
	| "rust"
	| "markdown";

type TagRole = "definition" | "reference";

type LocalCaptureKind = "scope" | "definition" | "reference";

export interface AstLanguage {
	id: SupportedLanguageId;
	extensions: string[];
	language: WasmLanguage;
	tagsQueryPath?: string;
	localsQueryPath?: string;
	metaVarChar: string;
	expandoChar: string;
	preProcessPattern(source: string): string;
	kindToId(kind: string, named?: boolean): number | null;
	fieldToId(field: string): number | null;
}

type LanguageConfig = AstLanguage;

interface LanguageSpec {
	id: SupportedLanguageId;
	extensions: string[];
	wasmFile: string;
	tagsQueryPath?: string;
	localsQueryPath?: string;
	expandoChar?: string;
}

interface ParsedFile {
	absPath: string;
	config: LanguageConfig;
	source: string;
	tree: WasmTree;
}

export interface AstRegistry {
	listLanguages(): AstLanguage[];
	languageForPath(filePath: string): AstLanguage | undefined;
	supportsOperation(filePath: string, operation: string): boolean;
	parseSource(
		language: AstLanguage,
		source: string,
		absPath?: string,
		includedRanges?: AstIncludedRange[],
	): AstDocument | null;
	parseIncludedRanges(
		language: AstLanguage,
		source: string,
		ranges: AstIncludedRange[],
		absPath?: string,
	): AstDocument | null;
	parseFile(filePath: string): ParsedFile | null;
	parsePattern(language: AstLanguage, source: string): AstPatternNode | null;
	loadQuery(language: AstLanguage, kind: "tags" | "locals"): WasmQuery | null;
}

export interface AstEdit {
	startIndex: number;
	oldEndIndex: number;
	newText: string;
}

export interface AstIncludedRange {
	startIndex: number;
	endIndex: number;
}

export interface AstPatternNode {
	kind: "meta" | "terminal" | "internal";
	name?: string;
	nodeType?: string;
	nodeTypeId?: number;
	text?: string;
	named?: boolean;
	children: AstPatternNode[];
}

export interface AstPatternMatch {
	node: AstNode;
	captures: Record<string, AstNode[]>;
}

interface TagEntry {
	kind: string;
	name: string;
	node: WasmNode;
	nameNode: WasmNode;
	role: TagRole;
}

interface LocalCapture {
	kind: LocalCaptureKind;
	name: string;
	node: WasmNode;
}

const require = createRequire(import.meta.url);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PACKAGE_ROOT = path.resolve(MODULE_DIR, "../..");
const TREE_SITTER_WASM_ROOT = path.dirname(
	require.resolve("@vscode/tree-sitter-wasm/package.json"),
);
const TREE_SITTER_WASM_DIR = path.join(TREE_SITTER_WASM_ROOT, "wasm");
const EXECUTABLE_DIR = process.execPath ? path.dirname(process.execPath) : null;

function hasTreeSitterAssets(root: string): boolean {
	return (
		fs.existsSync(path.join(root, "tree-sitter-queries")) ||
		fs.existsSync(path.join(root, "tree-sitter-wasm"))
	);
}

function resolveAssetRoot(): string {
	const candidates = [
		process.env.OPENLSP_ASSET_ROOT,
		process.cwd(),
		EXECUTABLE_DIR,
		EXECUTABLE_DIR ? path.resolve(EXECUTABLE_DIR, "..") : undefined,
		SOURCE_PACKAGE_ROOT,
	].filter((candidate): candidate is string => Boolean(candidate));

	for (const candidate of candidates) {
		const resolved = path.resolve(candidate);
		if (hasTreeSitterAssets(resolved)) return resolved;
	}
	return SOURCE_PACKAGE_ROOT;
}

const ASSET_ROOT = resolveAssetRoot();
const LOCAL_WASM_DIR = path.join(ASSET_ROOT, "tree-sitter-wasm");
const MARKDOWN_WASM_PATH = path.join(
	LOCAL_WASM_DIR,
	"tree-sitter-markdown.wasm",
);
const QUERY_ROOT = path.join(ASSET_ROOT, "tree-sitter-queries");
const { Parser, Language, Query } = TreeSitter;

await Parser.init({
	locateFile: (file) => path.join(TREE_SITTER_WASM_DIR, file),
});

const BUNDLED_LANGUAGE_SPECS: LanguageSpec[] = [
	{
		id: "bash",
		extensions: [".sh", ".bash", ".zsh"],
		wasmFile: "tree-sitter-bash.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "bash", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "bash", "locals.scm"),
	},
	{
		id: "csharp",
		extensions: [".cs"],
		wasmFile: "tree-sitter-c-sharp.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "csharp", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "csharp", "locals.scm"),
	},
	{
		id: "cpp",
		extensions: [
			".c",
			".h",
			".cc",
			".cpp",
			".cxx",
			".hpp",
			".hh",
			".m",
			".mm",
		],
		wasmFile: "tree-sitter-cpp.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "cpp", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "cpp", "locals.scm"),
	},
	{
		id: "css",
		extensions: [".css"],
		wasmFile: "tree-sitter-css.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "css", "tags.scm"),
	},
	{
		id: "go",
		extensions: [".go"],
		wasmFile: "tree-sitter-go.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "go", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "go", "locals.scm"),
	},
	{
		id: "ini",
		extensions: [".ini"],
		wasmFile: "tree-sitter-ini.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "ini", "tags.scm"),
	},
	{
		id: "java",
		extensions: [".java"],
		wasmFile: "tree-sitter-java.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "java", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "java", "locals.scm"),
	},
	{
		id: "javascript",
		extensions: [".js", ".jsx", ".mjs", ".cjs"],
		wasmFile: "tree-sitter-javascript.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "javascript", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "javascript", "locals.scm"),
	},
	{
		id: "php",
		extensions: [".php"],
		wasmFile: "tree-sitter-php.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "php", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "php", "locals.scm"),
	},
	{
		id: "powershell",
		extensions: [".ps1", ".psm1", ".psd1"],
		wasmFile: "tree-sitter-powershell.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "powershell", "tags.scm"),
	},
	{
		id: "python",
		extensions: [".py", ".pyi"],
		wasmFile: "tree-sitter-python.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "python", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "python", "locals.scm"),
	},
	{
		id: "regex",
		extensions: [".regex", ".re"],
		wasmFile: "tree-sitter-regex.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "regex", "tags.scm"),
	},
	{
		id: "ruby",
		extensions: [".rb"],
		wasmFile: "tree-sitter-ruby.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "ruby", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "ruby", "locals.scm"),
	},
	{
		id: "rust",
		extensions: [".rs"],
		wasmFile: "tree-sitter-rust.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "rust", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "rust", "locals.scm"),
	},
	{
		id: "tsx",
		extensions: [".tsx"],
		wasmFile: "tree-sitter-tsx.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "typescript", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "typescript", "locals.scm"),
	},
	{
		id: "typescript",
		extensions: [".ts", ".mts", ".cts"],
		wasmFile: "tree-sitter-typescript.wasm",
		tagsQueryPath: path.join(QUERY_ROOT, "typescript", "tags.scm"),
		localsQueryPath: path.join(QUERY_ROOT, "typescript", "locals.scm"),
	},
];

async function loadBundledLanguage(
	spec: LanguageSpec,
): Promise<(LanguageSpec & { language: WasmLanguage }) | null> {
	try {
		return {
			...spec,
			language: await Language.load(path.join(TREE_SITTER_WASM_DIR, spec.wasmFile)),
		};
	} catch {
		return null;
	}
}

const bundledLanguages = (
	await Promise.all(BUNDLED_LANGUAGE_SPECS.map(loadBundledLanguage))
).filter(
	(spec): spec is LanguageSpec & { language: WasmLanguage } => spec !== null,
);

async function loadMarkdownLanguage(): Promise<WasmLanguage | null> {
	if (!fs.existsSync(MARKDOWN_WASM_PATH)) return null;
	try {
		return await Language.load(MARKDOWN_WASM_PATH);
	} catch {
		return null;
	}
}

const markdownLanguage = await loadMarkdownLanguage();

const markdownParser = (() => {
	if (!markdownLanguage) return null;
	const parser = new Parser();
	parser.setLanguage(markdownLanguage);
	return parser;
})();

const DEFAULT_META_VAR_CHAR = "$";
const DEFAULT_EXPANDO_CHAR = "$";
const LANGUAGE_EXPANDO_CHARS: Partial<Record<SupportedLanguageId, string>> = {
	cpp: "\u{10000}",
	csharp: "µ",
	css: "_",
	go: "µ",
	php: "µ",
	python: "µ",
	ruby: "µ",
	rust: "µ",
};

function preProcessPatternSource(
	source: string,
	metaVarChar: string,
	expandoChar: string,
): string {
	if (metaVarChar === expandoChar) return source;
	return source.replace(/\$\$\$[A-Z_][A-Z0-9_]*|\$[A-Z_][A-Z0-9_]*/g, (match) =>
		match.replaceAll(metaVarChar, expandoChar),
	);
}

function createAstLanguage(
	spec: LanguageSpec & { language: WasmLanguage },
): AstLanguage {
	const expandoChar =
		spec.expandoChar ??
		LANGUAGE_EXPANDO_CHARS[spec.id] ??
		DEFAULT_EXPANDO_CHAR;
	return {
		id: spec.id,
		extensions: [...spec.extensions],
		language: spec.language,
		tagsQueryPath: spec.tagsQueryPath,
		localsQueryPath: spec.localsQueryPath,
		metaVarChar: DEFAULT_META_VAR_CHAR,
		expandoChar,
		preProcessPattern: (source) =>
			preProcessPatternSource(source, DEFAULT_META_VAR_CHAR, expandoChar),
		kindToId: (kind, named = true) => spec.language.idForNodeType(kind, named),
		fieldToId: (field) => spec.language.fieldIdForName(field),
	};
}

const LANGUAGE_CONFIGS: LanguageConfig[] = bundledLanguages.map((spec) => ({
	...createAstLanguage(spec),
}));

if (markdownLanguage) {
	LANGUAGE_CONFIGS.push({
		id: "markdown",
		extensions: [".md"],
		language: markdownLanguage,
		metaVarChar: DEFAULT_META_VAR_CHAR,
		expandoChar: DEFAULT_EXPANDO_CHAR,
		preProcessPattern: (source) => source,
		kindToId: (kind, named = true) => markdownLanguage.idForNodeType(kind, named),
		fieldToId: (field) => markdownLanguage.fieldIdForName(field),
	});
}

const SUPPORTED_OPERATIONS = new Set<TreeSitterOperation>([
	"diagnostics",
	"goToDefinition",
	"findReferences",
	"hover",
	"documentSymbol",
	"workspaceSymbol",
	"documentHighlight",
	"foldingRange",
]);

const MAX_WORKSPACE_SYMBOL_FILES = 400;
const MARKDOWN_WASM_EXTENSIONS = new Set([".md"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
const IGNORED_WORKSPACE_DIRS = new Set([
	".git",
	".hg",
	".svn",
	".next",
	".nuxt",
	".turbo",
	".tmp",
	"dist",
	"build",
	"coverage",
	"node_modules",
]);

function sanitizeQuerySource(source: string): string {
	return source
		.split(/\r?\n/)
		.filter(
			(line) =>
				!line.includes("#strip!") && !line.includes("#select-adjacent!"),
		)
		.join("\n");
}

interface MarkdownHeading {
	level: number;
	text: string;
	line: number;
	startCharacter: number;
	endCharacter: number;
	endLine: number;
}

interface MarkdownFence {
	startLine: number;
	endLine: number;
}

interface MarkdownReferenceDefinition {
	label: string;
	url: string;
	line: number;
	labelStartCharacter: number;
	labelEndCharacter: number;
	urlStartCharacter: number;
	urlEndCharacter: number;
}

interface MarkdownReferenceUsage {
	label: string;
	line: number;
	startCharacter: number;
	endCharacter: number;
}

interface MarkdownInlineLink {
	target: string;
	line: number;
	startCharacter: number;
	endCharacter: number;
}

interface MarkdownSection {
	heading: MarkdownHeading;
	children: MarkdownSection[];
}

interface ParsedMarkdownFile {
	absPath: string;
	lines: string[];
	sections: MarkdownSection[];
	headings: MarkdownHeading[];
	fences: MarkdownFence[];
	referenceDefinitions: MarkdownReferenceDefinition[];
	referenceUsages: MarkdownReferenceUsage[];
	inlineLinks: MarkdownInlineLink[];
}

function isMarkdownFile(filePath: string): boolean {
	return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isMarkdownWasmFile(filePath: string): boolean {
	return MARKDOWN_WASM_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function markdownSupportsOperation(operation: string): boolean {
	return (
		operation === "goToDefinition" ||
		operation === "findReferences" ||
		operation === "hover" ||
		operation === "documentHighlight" ||
		operation === "documentSymbol" ||
		operation === "workspaceSymbol" ||
		operation === "foldingRange"
	);
}

function getLanguageConfig(filePath: string): LanguageConfig | undefined {
	const ext = path.extname(filePath).toLowerCase();
	return LANGUAGE_CONFIGS.find((config) => config.extensions.includes(ext));
}

function toPoint(line: number, character: number): WasmPoint {
	return {
		row: Math.max(0, line - 1),
		column: Math.max(0, character - 1),
	};
}

function toRange(node: WasmNode) {
	return {
		start: {
			line: node.startPosition.row,
			character: node.startPosition.column,
		},
		end: {
			line: node.endPosition.row,
			character: node.endPosition.column,
		},
	};
}

function pointInNode(node: WasmNode, point: WasmPoint): boolean {
	const startBefore =
		node.startPosition.row < point.row ||
		(node.startPosition.row === point.row &&
			node.startPosition.column <= point.column);
	const endAfter =
		node.endPosition.row > point.row ||
		(node.endPosition.row === point.row &&
			node.endPosition.column >= point.column);
	return startBefore && endAfter;
}

function containsNode(outer: WasmNode, inner: WasmNode): boolean {
	return (
		outer.startIndex <= inner.startIndex && outer.endIndex >= inner.endIndex
	);
}

function nodeSpan(node: WasmNode): number {
	return node.endIndex - node.startIndex;
}

function isIdentifierLike(node: WasmNode | null | undefined): boolean {
	if (!node || !node.isNamed) return false;
	return /^[A-Za-z_$][\w$]*$/.test(node.text);
}

function nodeToLocation(absPath: string, node: WasmNode): Location {
	return {
		uri: pathToFileURL(absPath).href,
		range: toRange(node),
	};
}

function byteLength(source: string): number {
	return new TextEncoder().encode(source).length;
}

function byteOffsetToStringIndex(source: string, byteOffset: number): number {
	if (byteOffset <= 0) return 0;
	let bytes = 0;
	for (let index = 0; index < source.length; ) {
		const codePoint = source.codePointAt(index);
		const char = codePoint === undefined ? "" : String.fromCodePoint(codePoint);
		const nextBytes = bytes + byteLength(char);
		if (nextBytes > byteOffset) return index;
		bytes = nextBytes;
		index += char.length;
	}
	return source.length;
}

function positionForByteOffset(source: string, byteOffset: number): WasmPoint {
	const index = byteOffsetToStringIndex(source, byteOffset);
	let row = 0;
	let column = 0;
	for (let current = 0; current < index; ) {
		const codePoint = source.codePointAt(current);
		const char = codePoint === undefined ? "" : String.fromCodePoint(codePoint);
		if (char === "\n") {
			row += 1;
			column = 0;
		} else {
			column += byteLength(char);
		}
		current += char.length;
	}
	return { row, column };
}

function includedRangesToTreeSitterRanges(
	source: string,
	ranges: AstIncludedRange[],
) {
	return ranges
		.filter((range) => range.endIndex > range.startIndex)
		.sort((a, b) => a.startIndex - b.startIndex)
		.map((range) => ({
			startIndex: byteOffsetToStringIndex(source, range.startIndex),
			endIndex: byteOffsetToStringIndex(source, range.endIndex),
			startPosition: positionForByteOffset(source, range.startIndex),
			endPosition: positionForByteOffset(source, range.endIndex),
		}));
}

function astPatternNodeFromTreeNode(
	node: WasmNode,
	language: AstLanguage,
): AstPatternNode {
	const text = node.text;
	const metaName = extractMetaVariable(text, language);
	if (metaName) {
		return {
			kind: "meta",
			name: metaName,
			children: [],
		};
	}
	const children = node.namedChildren
		.filter((child): child is WasmNode => child !== null && !child.isMissing)
		.map((child) => astPatternNodeFromTreeNode(child, language));
	if (children.length === 0) {
		return {
			kind: "terminal",
			nodeType: node.type,
			nodeTypeId: node.typeId,
			text,
			named: node.isNamed,
			children: [],
		};
	}
	return {
		kind: "internal",
		nodeType: node.type,
		nodeTypeId: node.typeId,
		named: node.isNamed,
		children,
	};
}

function astPatternRootFromTreeNode(
	node: WasmNode,
	language: AstLanguage,
): AstPatternNode {
	const namedChildren = node.namedChildren.filter(
		(child): child is WasmNode => child !== null && !child.isMissing,
	);
	if (namedChildren.length === 1) {
		return astPatternNodeFromTreeNode(namedChildren[0], language);
	}
	return astPatternNodeFromTreeNode(node, language);
}

function extractMetaVariable(
	text: string,
	language: AstLanguage,
): string | null {
	const sigil = language.expandoChar;
	const escaped = sigil.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = text.match(new RegExp(`^${escaped}{1,3}([A-Z_][A-Z0-9_]*)$`));
	return match?.[1] ?? null;
}

function cloneCaptures(
	captures: Record<string, AstNode[]>,
): Record<string, AstNode[]> {
	return Object.fromEntries(
		Object.entries(captures).map(([name, nodes]) => [name, [...nodes]]),
	);
}

function matchAstPattern(
	pattern: AstPatternNode,
	node: AstNode,
	captures: Record<string, AstNode[]> = {},
): Record<string, AstNode[]> | null {
	if (pattern.kind === "meta") {
		if (!pattern.name) return captures;
		return {
			...captures,
			[pattern.name]: [...(captures[pattern.name] ?? []), node],
		};
	}

	if (pattern.nodeTypeId !== undefined && node.kindId !== pattern.nodeTypeId)
		return null;
	if (pattern.nodeType && node.kind !== pattern.nodeType) return null;
	if (pattern.kind === "terminal" && pattern.text !== undefined) {
		const metaLike = /^[A-Z_][A-Z0-9_]*$/.test(pattern.text);
		if (!metaLike && node.text !== pattern.text) return null;
	}

	const patternChildren = pattern.children;
	if (patternChildren.length === 0) return captures;

	const nodeChildren = node.namedChildren.filter((child) => !child.isMissing);
	if (nodeChildren.length < patternChildren.length) return null;

	let nextCaptures = cloneCaptures(captures);
	let nodeIndex = 0;
	for (const patternChild of patternChildren) {
		let matched: Record<string, AstNode[]> | null = null;
		while (nodeIndex < nodeChildren.length && !matched) {
			matched = matchAstPattern(
				patternChild,
				nodeChildren[nodeIndex],
				nextCaptures,
			);
			nodeIndex += 1;
		}
		if (!matched) return null;
		nextCaptures = matched;
	}
	return nextCaptures;
}

function findAstPatternMatches(
	root: AstNode,
	pattern: AstPatternNode,
): AstPatternMatch[] {
	const matches: AstPatternMatch[] = [];
	root.visit((node) => {
		const captures = matchAstPattern(pattern, node);
		if (captures) matches.push({ node, captures });
	});
	return matches;
}

export class AstNode {
	constructor(
		readonly raw: WasmNode,
		readonly document: AstDocument,
	) {}

	get kind(): string {
		return this.raw.type;
	}

	get kindId(): number {
		return this.raw.typeId;
	}

	get text(): string {
		return this.raw.text;
	}

	get range() {
		return toRange(this.raw);
	}

	get isNamed(): boolean {
		return this.raw.isNamed;
	}

	get isError(): boolean {
		return this.raw.isError;
	}

	get isMissing(): boolean {
		return this.raw.isMissing;
	}

	get children(): AstNode[] {
		return this.raw.children
			.filter((child): child is WasmNode => child !== null)
			.map((child) => new AstNode(child, this.document));
	}

	get namedChildren(): AstNode[] {
		return this.raw.namedChildren
			.filter((child): child is WasmNode => child !== null)
			.map((child) => new AstNode(child, this.document));
	}

	childForFieldName(fieldName: string): AstNode | null {
		const child = this.raw.childForFieldName(fieldName);
		return child ? new AstNode(child, this.document) : null;
	}

	visit(visitor: (node: AstNode) => boolean | void): void {
		const shouldSkipChildren = visitor(this);
		if (shouldSkipChildren) return;
		for (const child of this.children) child.visit(visitor);
	}

	closest(types: string[]): AstNode | null {
		const node = closestNodeOfTypes(this.raw, types);
		return node ? new AstNode(node, this.document) : null;
	}
}

export class AstDocument {
	private constructor(
		readonly language: AstLanguage,
		private parser: WasmParser,
		public source: string,
		private tree: WasmTree,
		readonly absPath?: string,
	) {}

	static parse(
		language: AstLanguage,
		parser: WasmParser,
		source: string,
		absPath?: string,
		includedRanges: AstIncludedRange[] = [],
	): AstDocument | null {
		const tree = parser.parse(
			source,
			null,
			includedRanges.length > 0
				? {
						includedRanges: includedRangesToTreeSitterRanges(
							source,
							includedRanges,
						),
					}
				: undefined,
		);
		if (!tree) return null;
		return new AstDocument(language, parser, source, tree, absPath);
	}

	get root(): AstNode {
		return new AstNode(this.tree.rootNode, this);
	}

	get rawTree(): WasmTree {
		return this.tree;
	}

	edit(edit: AstEdit): boolean {
		const before = this.source;
		const startStringIndex = byteOffsetToStringIndex(before, edit.startIndex);
		const oldEndStringIndex = byteOffsetToStringIndex(before, edit.oldEndIndex);
		const nextSource =
			before.slice(0, startStringIndex) +
			edit.newText +
			before.slice(oldEndStringIndex);
		const newEndIndex = edit.startIndex + byteLength(edit.newText);
		this.tree.edit({
			startIndex: edit.startIndex,
			oldEndIndex: edit.oldEndIndex,
			newEndIndex,
			startPosition: positionForByteOffset(before, edit.startIndex),
			oldEndPosition: positionForByteOffset(before, edit.oldEndIndex),
			newEndPosition: positionForByteOffset(nextSource, newEndIndex),
		});
		const nextTree = this.parser.parse(nextSource, this.tree);
		if (!nextTree) return false;
		this.source = nextSource;
		this.tree = nextTree;
		return true;
	}

	nodeAt(line: number, character: number): AstNode | null {
		const node = findNamedNodeAtPosition(this.tree.rootNode, line, character);
		return node ? new AstNode(node, this) : null;
	}

	findAll(pattern: AstPatternNode): AstPatternMatch[] {
		return findAstPatternMatches(this.root, pattern);
	}

	toParsedFile(absPath = this.absPath ?? ""): ParsedFile {
		return {
			absPath,
			config: this.language,
			source: this.source,
			tree: this.tree,
		};
	}
}

export class AstLanguageRegistry implements AstRegistry {
	private readonly languages = new Map<SupportedLanguageId, AstLanguage>();
	private readonly parsers = new Map<SupportedLanguageId, WasmParser>();
	private readonly queries = new Map<string, WasmQuery | null>();

	constructor(languages: AstLanguage[] = LANGUAGE_CONFIGS) {
		for (const language of languages) this.languages.set(language.id, language);
	}

	listLanguages(): AstLanguage[] {
		return [...this.languages.values()];
	}

	getLanguage(id: SupportedLanguageId): AstLanguage | undefined {
		return this.languages.get(id);
	}

	languageForPath(filePath: string): AstLanguage | undefined {
		const ext = path.extname(filePath).toLowerCase();
		return this.listLanguages().find((language) =>
			language.extensions.includes(ext),
		);
	}

	supportsOperation(filePath: string, operation: string): boolean {
		if (isMarkdownFile(filePath)) return markdownSupportsOperation(operation);
		const language = this.languageForPath(filePath);
		if (!language) return false;
		return SUPPORTED_OPERATIONS.has(operation as TreeSitterOperation);
	}

	parseSource(
		language: AstLanguage,
		source: string,
		absPath?: string,
		includedRanges: AstIncludedRange[] = [],
	): AstDocument | null {
		return AstDocument.parse(
			language,
			this.parserFor(language),
			source,
			absPath,
			includedRanges,
		);
	}

	parseIncludedRanges(
		language: AstLanguage,
		source: string,
		ranges: AstIncludedRange[],
		absPath?: string,
	): AstDocument | null {
		return this.parseSource(language, source, absPath, ranges);
	}

	parseFile(filePath: string): ParsedFile | null {
		const absPath = path.resolve(filePath);
		const language = this.languageForPath(absPath);
		if (!language) return null;

		let source: string;
		try {
			source = fs.readFileSync(absPath, "utf-8");
		} catch {
			return null;
		}

		return this.parseSource(language, source, absPath)?.toParsedFile(absPath) ?? null;
	}

	parsePattern(language: AstLanguage, source: string): AstPatternNode | null {
		const processed = language.preProcessPattern(source);
		const document = this.parseSource(language, processed);
		if (!document) return null;
		return astPatternRootFromTreeNode(document.rawTree.rootNode, language);
	}

	loadQuery(
		language: AstLanguage,
		kind: "tags" | "locals",
	): WasmQuery | null {
		const queryPath =
			kind === "tags" ? language.tagsQueryPath : language.localsQueryPath;
		if (!queryPath || !fs.existsSync(queryPath)) return null;

		const cacheKey = `${language.id}:${kind}`;
		if (this.queries.has(cacheKey)) return this.queries.get(cacheKey) ?? null;

		try {
			const source = sanitizeQuerySource(fs.readFileSync(queryPath, "utf-8"));
			const query = new Query(language.language, source);
			this.queries.set(cacheKey, query);
			return query;
		} catch {
			this.queries.set(cacheKey, null);
			return null;
		}
	}

	private parserFor(language: AstLanguage): WasmParser {
		const existing = this.parsers.get(language.id);
		if (existing) return existing;
		const parser = new Parser();
		parser.setLanguage(language.language);
		this.parsers.set(language.id, parser);
		return parser;
	}
}

function markdownSelectionRange(
	line: number,
	startCharacter: number,
	endCharacter: number,
) {
	return {
		start: { line, character: startCharacter },
		end: { line, character: endCharacter },
	};
}

function markdownRange(lines: string[], heading: MarkdownHeading) {
	return {
		start: { line: heading.line, character: 0 },
		end: {
			line: heading.endLine,
			character: lines[heading.endLine]?.length ?? 0,
		},
	};
}

function markdownSymbolKind(): SymbolKind {
	return SymbolKind.Namespace;
}

function normalizeMarkdownLabel(label: string): string {
	return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function slugifyMarkdownHeading(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/<[^>]+>/g, "")
		.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-");
}

function markdownLocation(
	absPath: string,
	line: number,
	startCharacter: number,
	endCharacter: number,
): Location {
	return {
		uri: pathToFileURL(absPath).href,
		range: markdownSelectionRange(line, startCharacter, endCharacter),
	};
}

function isMarkdownPosition(
	line: number,
	character: number,
	targetLine: number,
	startCharacter: number,
	endCharacter: number,
): boolean {
	return (
		line - 1 === targetLine &&
		character - 1 >= startCharacter &&
		character - 1 <= endCharacter
	);
}

function markdownHover(value: string): Hover {
	return {
		contents: {
			kind: "markdown",
			value,
		},
	};
}

function cleanMarkdownLinkTarget(target: string): string {
	const trimmed = target.trim();
	const withoutTitle =
		trimmed.match(/^<([^>]+)>$/)?.[1] ??
		trimmed.match(/^([^\s]+)(?:\s+.+)?$/)?.[1] ??
		trimmed;
	return withoutTitle;
}

function uniqLocations(locations: Location[]): Location[] {
	const seen = new Set<string>();
	return locations.filter((location) => {
		const key = `${location.uri}:${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function inclusiveMarkdownEndLine(node: WasmNode): number {
	return node.endPosition.column === 0 &&
		node.endPosition.row > node.startPosition.row
		? node.endPosition.row - 1
		: node.endPosition.row;
}

function normalizeMarkdownHeadingText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function markdownHeadingContentNode(node: WasmNode): WasmNode | null {
	const contentNode = node.childForFieldName("heading_content");
	if (!contentNode) return null;
	if (contentNode.type === "paragraph") {
		return (
			contentNode.namedChildren.find(
				(child): child is WasmNode => child !== null && child.type === "inline",
			) ?? contentNode
		);
	}
	return contentNode;
}

function markdownHeadingLevel(node: WasmNode): number {
	const marker = node.namedChildren.find(
		(child): child is WasmNode =>
			child !== null && /^atx_h[1-6]_marker$/.test(child.type),
	);
	if (marker) return Number(marker.type.match(/\d+/)?.[0] ?? 1);
	return node.namedChildren.some(
		(child) => child !== null && child.type === "setext_h1_underline",
	)
		? 1
		: 2;
}

function markdownHeadingFromSection(
	sectionNode: WasmNode,
): MarkdownHeading | null {
	const headingNode = sectionNode.namedChildren.find(
		(child): child is WasmNode =>
			child !== null &&
			(child.type === "atx_heading" || child.type === "setext_heading"),
	);
	if (!headingNode) return null;

	const contentNode = markdownHeadingContentNode(headingNode);
	if (!contentNode) return null;

	const text = normalizeMarkdownHeadingText(contentNode.text);
	if (!text) return null;

	return {
		level: markdownHeadingLevel(headingNode),
		text,
		line: contentNode.startPosition.row,
		startCharacter: contentNode.startPosition.column,
		endCharacter: contentNode.endPosition.column,
		endLine: Math.max(
			contentNode.startPosition.row,
			inclusiveMarkdownEndLine(sectionNode),
		),
	};
}

function buildMarkdownSection(sectionNode: WasmNode): MarkdownSection | null {
	const heading = markdownHeadingFromSection(sectionNode);
	if (!heading) return null;

	const children = sectionNode.namedChildren
		.filter(
			(child): child is WasmNode => child !== null && child.type === "section",
		)
		.map((child) => buildMarkdownSection(child))
		.filter((section): section is MarkdownSection => section !== null);

	return { heading, children };
}

function buildMarkdownSections(root: WasmNode): MarkdownSection[] {
	return root.namedChildren
		.filter(
			(child): child is WasmNode => child !== null && child.type === "section",
		)
		.map((child) => buildMarkdownSection(child))
		.filter((section): section is MarkdownSection => section !== null);
}

function flattenMarkdownSections(
	sections: MarkdownSection[],
): MarkdownHeading[] {
	return sections.flatMap((section) => [
		section.heading,
		...flattenMarkdownSections(section.children),
	]);
}

function collectMarkdownFences(root: WasmNode): MarkdownFence[] {
	const fences: MarkdownFence[] = [];
	visitTree(root, (node) => {
		if (node.type !== "fenced_code_block") return;
		fences.push({
			startLine: node.startPosition.row,
			endLine: inclusiveMarkdownEndLine(node),
		});
		return true;
	});
	return fences;
}

function collectMarkdownReferenceDefinitions(
	root: WasmNode,
): MarkdownReferenceDefinition[] {
	const definitions: MarkdownReferenceDefinition[] = [];
	visitTree(root, (node) => {
		if (node.type !== "link_reference_definition") return;

		const labelNode = node.namedChildren.find(
			(child): child is WasmNode =>
				child !== null && child.type === "link_label",
		);
		const destinationNode = node.namedChildren.find(
			(child): child is WasmNode =>
				child !== null && child.type === "link_destination",
		);
		if (!labelNode || !destinationNode) return true;

		const rawLabel = labelNode.text.replace(/^\[/, "").replace(/\]$/, "");
		const url = cleanMarkdownLinkTarget(destinationNode.text);
		definitions.push({
			label: normalizeMarkdownLabel(rawLabel),
			url,
			line: labelNode.startPosition.row,
			labelStartCharacter: labelNode.startPosition.column + 1,
			labelEndCharacter: Math.max(
				labelNode.startPosition.column + 1,
				labelNode.endPosition.column - 1,
			),
			urlStartCharacter: destinationNode.startPosition.column,
			urlEndCharacter: destinationNode.endPosition.column,
		});
		return true;
	});
	return definitions;
}

function collectMarkdownInlineData(
	lines: string[],
	fences: MarkdownFence[],
): Pick<ParsedMarkdownFile, "referenceUsages" | "inlineLinks"> {
	const referenceUsages: MarkdownReferenceUsage[] = [];
	const inlineLinks: MarkdownInlineLink[] = [];

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const isInsideFence = fences.some(
			(fence) => index >= fence.startLine && index <= fence.endLine,
		);
		if (isInsideFence) continue;

		for (const match of line.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
			const whole = match[0] ?? "";
			const rawTarget = cleanMarkdownLinkTarget(match[1] ?? "");
			const startCharacter = (match.index ?? 0) + whole.indexOf("(") + 1;
			inlineLinks.push({
				target: rawTarget,
				line: index,
				startCharacter,
				endCharacter: startCharacter + rawTarget.length,
			});
		}

		for (const match of line.matchAll(/\[[^\]]+\]\[([^\]]+)\]/g)) {
			const whole = match[0] ?? "";
			const rawLabel = match[1] ?? "";
			const startCharacter = (match.index ?? 0) + whole.lastIndexOf("[") + 1;
			referenceUsages.push({
				label: normalizeMarkdownLabel(rawLabel),
				line: index,
				startCharacter,
				endCharacter: startCharacter + rawLabel.length,
			});
		}
	}

	return { referenceUsages, inlineLinks };
}

function finalizeMarkdownHeadingEndLines(
	lines: string[],
	headings: MarkdownHeading[],
): void {
	const lastContentLine = (() => {
		for (let index = lines.length - 1; index >= 0; index--) {
			if ((lines[index] ?? "").trim()) return index;
		}
		return 0;
	})();

	for (let index = 0; index < headings.length; index++) {
		const heading = headings[index]!;
		const nextBoundary = headings
			.slice(index + 1)
			.find((candidate) => candidate.level <= heading.level);
		heading.endLine = Math.max(
			heading.line,
			Math.min(
				nextBoundary ? nextBoundary.line - 1 : lastContentLine,
				lastContentLine,
			),
		);
	}
}

function parseMarkdownFallback(
	absPath: string,
	lines: string[],
): ParsedMarkdownFile {
	const headings: MarkdownHeading[] = [];
	const fences: MarkdownFence[] = [];
	const referenceDefinitions: MarkdownReferenceDefinition[] = [];
	const referenceUsages: MarkdownReferenceUsage[] = [];
	const inlineLinks: MarkdownInlineLink[] = [];
	let activeFence: {
		marker: string;
		length: number;
		startLine: number;
	} | null = null;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";

		const fenceMatch = line.match(/^\s{0,3}(```+|~~~+)/);
		if (fenceMatch) {
			const marker = fenceMatch[1]![0]!;
			const length = fenceMatch[1]!.length;
			if (!activeFence) {
				activeFence = { marker, length, startLine: index };
				continue;
			}
			if (activeFence.marker === marker && length >= activeFence.length) {
				fences.push({ startLine: activeFence.startLine, endLine: index });
				activeFence = null;
			}
			continue;
		}

		if (activeFence) continue;

		const atxMatch = line.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
		if (atxMatch) {
			const hashes = atxMatch[1] ?? "#";
			const text = normalizeMarkdownHeadingText(atxMatch[2] ?? "");
			if (!text) continue;
			const startCharacter = Math.max(0, line.indexOf(text));
			headings.push({
				level: hashes.length,
				text,
				line: index,
				startCharacter,
				endCharacter: startCharacter + text.length,
				endLine: index,
			});
			continue;
		}

		const nextLine = lines[index + 1] ?? "";
		const setextMatch = nextLine.match(/^\s{0,3}(=+|-+)\s*$/);
		if (setextMatch && line.trim()) {
			const startCharacter = line.search(/\S|$/);
			const text = normalizeMarkdownHeadingText(line);
			headings.push({
				level: setextMatch[1]![0] === "=" ? 1 : 2,
				text,
				line: index,
				startCharacter,
				endCharacter: startCharacter + text.length,
				endLine: index + 1,
			});
			index += 1;
			continue;
		}

		const referenceDefinitionMatch = line.match(
			/^\s{0,3}\[([^\]]+)\]:\s*(\S+)/,
		);
		if (referenceDefinitionMatch) {
			const label = referenceDefinitionMatch[1] ?? "";
			const url = cleanMarkdownLinkTarget(referenceDefinitionMatch[2] ?? "");
			const labelStartCharacter = line.indexOf("[") + 1;
			const labelEndCharacter = labelStartCharacter + label.length;
			const urlStartCharacter = line.indexOf(
				referenceDefinitionMatch[2] ?? url,
				labelEndCharacter,
			);
			referenceDefinitions.push({
				label: normalizeMarkdownLabel(label),
				url,
				line: index,
				labelStartCharacter,
				labelEndCharacter,
				urlStartCharacter: Math.max(0, urlStartCharacter),
				urlEndCharacter: Math.max(0, urlStartCharacter) + url.length,
			});
		}

		for (const match of line.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
			const whole = match[0] ?? "";
			const rawTarget = cleanMarkdownLinkTarget(match[1] ?? "");
			const startCharacter = (match.index ?? 0) + whole.indexOf("(") + 1;
			inlineLinks.push({
				target: rawTarget,
				line: index,
				startCharacter,
				endCharacter: startCharacter + rawTarget.length,
			});
		}

		for (const match of line.matchAll(/\[[^\]]+\]\[([^\]]+)\]/g)) {
			const whole = match[0] ?? "";
			const rawLabel = match[1] ?? "";
			const startCharacter = (match.index ?? 0) + whole.lastIndexOf("[") + 1;
			referenceUsages.push({
				label: normalizeMarkdownLabel(rawLabel),
				line: index,
				startCharacter,
				endCharacter: startCharacter + rawLabel.length,
			});
		}
	}

	finalizeMarkdownHeadingEndLines(lines, headings);

	return {
		absPath,
		lines,
		sections: [],
		headings,
		fences,
		referenceDefinitions,
		referenceUsages,
		inlineLinks,
	};
}

function parseMarkdownFile(filePath: string): ParsedMarkdownFile | null {
	const absPath = path.resolve(filePath);
	if (!isMarkdownFile(absPath)) return null;

	let source: string;
	try {
		source = fs.readFileSync(absPath, "utf-8");
	} catch {
		return null;
	}

	const lines = source.split(/\r?\n/);
	if (isMarkdownWasmFile(absPath) && markdownParser) {
		const tree = markdownParser.parse(source);
		if (tree) {
			const sections = buildMarkdownSections(tree.rootNode);
			const fences = collectMarkdownFences(tree.rootNode);
			const referenceDefinitions = collectMarkdownReferenceDefinitions(
				tree.rootNode,
			);
			const { referenceUsages, inlineLinks } = collectMarkdownInlineData(
				lines,
				fences,
			);
			return {
				absPath,
				lines,
				sections,
				headings: flattenMarkdownSections(sections),
				fences,
				referenceDefinitions,
				referenceUsages,
				inlineLinks,
			};
		}
	}

	return parseMarkdownFallback(absPath, lines);
}

function findMarkdownHeadingAtPosition(
	parsed: ParsedMarkdownFile,
	line: number,
	character: number,
): MarkdownHeading | undefined {
	return parsed.headings.find((heading) =>
		isMarkdownPosition(
			line,
			character,
			heading.line,
			heading.startCharacter,
			heading.endCharacter,
		),
	);
}

function findMarkdownInlineLinkAtPosition(
	parsed: ParsedMarkdownFile,
	line: number,
	character: number,
): MarkdownInlineLink | undefined {
	return parsed.inlineLinks.find((link) =>
		isMarkdownPosition(
			line,
			character,
			link.line,
			link.startCharacter,
			link.endCharacter,
		),
	);
}

function findMarkdownReferenceUsageAtPosition(
	parsed: ParsedMarkdownFile,
	line: number,
	character: number,
): MarkdownReferenceUsage | undefined {
	return parsed.referenceUsages.find((usage) =>
		isMarkdownPosition(
			line,
			character,
			usage.line,
			usage.startCharacter,
			usage.endCharacter,
		),
	);
}

function findMarkdownReferenceDefinitionAtPosition(
	parsed: ParsedMarkdownFile,
	line: number,
	character: number,
): MarkdownReferenceDefinition | undefined {
	return parsed.referenceDefinitions.find(
		(definition) =>
			isMarkdownPosition(
				line,
				character,
				definition.line,
				definition.labelStartCharacter,
				definition.labelEndCharacter,
			) ||
			isMarkdownPosition(
				line,
				character,
				definition.line,
				definition.urlStartCharacter,
				definition.urlEndCharacter,
			),
	);
}

function findMarkdownHeadingBySlug(
	parsed: ParsedMarkdownFile,
	slug: string,
): MarkdownHeading | undefined {
	const normalizedSlug = slug.replace(/^#/, "").toLowerCase();
	return parsed.headings.find(
		(heading) => slugifyMarkdownHeading(heading.text) === normalizedSlug,
	);
}

function markdownHeadingLocation(
	parsed: ParsedMarkdownFile,
	heading: MarkdownHeading,
): Location {
	return markdownLocation(
		parsed.absPath,
		heading.line,
		heading.startCharacter,
		heading.endCharacter,
	);
}

function markdownReferenceDefinitionLocation(
	parsed: ParsedMarkdownFile,
	definition: MarkdownReferenceDefinition,
): Location {
	return markdownLocation(
		parsed.absPath,
		definition.line,
		definition.labelStartCharacter,
		definition.labelEndCharacter,
	);
}

function markdownReferenceUsageLocation(
	parsed: ParsedMarkdownFile,
	usage: MarkdownReferenceUsage,
): Location {
	return markdownLocation(
		parsed.absPath,
		usage.line,
		usage.startCharacter,
		usage.endCharacter,
	);
}

function markdownInlineLinkLocation(
	parsed: ParsedMarkdownFile,
	link: MarkdownInlineLink,
): Location {
	return markdownLocation(
		parsed.absPath,
		link.line,
		link.startCharacter,
		link.endCharacter,
	);
}

function markdownSectionToDocumentSymbol(
	lines: string[],
	section: MarkdownSection,
): DocumentSymbol {
	const { heading } = section;
	return {
		name: heading.text,
		kind: markdownSymbolKind(),
		range: markdownRange(lines, heading),
		selectionRange: markdownSelectionRange(
			heading.line,
			heading.startCharacter,
			heading.endCharacter,
		),
		children: section.children.map((child) =>
			markdownSectionToDocumentSymbol(lines, child),
		),
	};
}

function markdownDocumentSymbols(parsed: ParsedMarkdownFile): DocumentSymbol[] {
	if (parsed.sections.length > 0) {
		return parsed.sections.map((section) =>
			markdownSectionToDocumentSymbol(parsed.lines, section),
		);
	}

	const roots: Array<DocumentSymbol & { _level?: number }> = [];
	const stack: Array<DocumentSymbol & { _level?: number }> = [];

	for (const heading of parsed.headings) {
		const symbol: DocumentSymbol & { _level?: number } = {
			name: heading.text,
			kind: markdownSymbolKind(),
			range: markdownRange(parsed.lines, heading),
			selectionRange: markdownSelectionRange(
				heading.line,
				heading.startCharacter,
				heading.endCharacter,
			),
			children: [],
			_level: heading.level,
		};

		while (
			stack.length > 0 &&
			(stack[stack.length - 1]!._level ?? 0) >= heading.level
		) {
			stack.pop();
		}
		if (stack.length === 0) roots.push(symbol);
		else stack[stack.length - 1]!.children!.push(symbol);
		stack.push(symbol);
	}

	const stripLevel = (
		symbols: Array<DocumentSymbol & { _level?: number }>,
	): DocumentSymbol[] =>
		symbols.map((symbol) => ({
			name: symbol.name,
			kind: symbol.kind,
			range: symbol.range,
			selectionRange: symbol.selectionRange,
			children: stripLevel(
				(symbol.children as
					| Array<DocumentSymbol & { _level?: number }>
					| undefined) ?? [],
			),
		}));

	return stripLevel(roots);
}

function closestNodeOfTypes(node: WasmNode, types: string[]): WasmNode | null {
	let current: WasmNode | null = node;
	while (current) {
		if (types.includes(current.type)) return current;
		current = current.parent;
	}
	return null;
}

function shouldSkipWorkspaceDir(dirName: string): boolean {
	return IGNORED_WORKSPACE_DIRS.has(dirName);
}

function collectWorkspaceFiles(
	rootPath: string,
	limit = MAX_WORKSPACE_SYMBOL_FILES,
): string[] {
	const resolved = path.resolve(rootPath);
	let rootDir = resolved;

	try {
		const stats = fs.statSync(resolved);
		if (!stats.isDirectory()) rootDir = path.dirname(resolved);
	} catch {
		rootDir = path.dirname(resolved);
	}

	const files: string[] = [];
	const stack = [rootDir];

	while (stack.length > 0 && files.length < limit) {
		const current = stack.pop()!;
		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (files.length >= limit) break;
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (!shouldSkipWorkspaceDir(entry.name)) stack.push(fullPath);
				continue;
			}
			if (
				entry.isFile() &&
				(getLanguageConfig(fullPath) || isMarkdownFile(fullPath))
			)
				files.push(fullPath);
		}
	}

	return files;
}

function visitTree(
	node: WasmNode,
	visitor: (node: WasmNode) => boolean | void,
): void {
	const shouldSkipChildren = visitor(node);
	if (shouldSkipChildren) return;
	for (const child of node.children) {
		if (child) visitTree(child, visitor);
	}
}

function findNamedNodeAtPosition(
	root: WasmNode,
	line: number,
	character: number,
): WasmNode | null {
	const point = toPoint(line, character);
	let node: WasmNode | null = root.namedDescendantForPosition(point);
	if (isIdentifierLike(node)) return node;

	while (node && !isIdentifierLike(node)) {
		const child = node.namedChildren.find(
			(candidate) =>
				candidate !== null &&
				pointInNode(candidate, point) &&
				isIdentifierLike(candidate),
		);
		if (child) return child;
		node = node.parent;
	}

	return isIdentifierLike(node) ? node : null;
}

function syntaxDiagnosticMessage(node: WasmNode): string {
	if (node.isMissing) return `Missing ${node.type}`;
	const snippet = node.text.replace(/\s+/g, " ").trim();
	if (!snippet) return "Syntax error";
	return `Syntax error near '${snippet.slice(0, 40)}'`;
}

function symbolKindFromTag(kind: string): SymbolKind {
	switch (kind) {
		case "class":
			return SymbolKind.Class;
		case "interface":
			return SymbolKind.Interface;
		case "method":
			return SymbolKind.Method;
		case "function":
			return SymbolKind.Function;
		case "module":
			return SymbolKind.Module;
		case "constant":
			return SymbolKind.Constant;
		case "type":
			return SymbolKind.Class;
		case "call":
			return SymbolKind.Function;
		default:
			return SymbolKind.Variable;
	}
}

function collectDeclarationLikeNodes(root: WasmNode): TagEntry[] {
	const tags: TagEntry[] = [];
	visitTree(root, (node) => {
		const nameNode = node.childForFieldName("name");
		if (!nameNode || !isIdentifierLike(nameNode)) return;
		const type = node.type;
		let kind: string | null = null;
		if (type.includes("class")) kind = "class";
		else if (type.includes("interface")) kind = "interface";
		else if (type.includes("method")) kind = "method";
		else if (type.includes("function") || type.includes("lambda"))
			kind = "function";
		else if (type.includes("module") || type.includes("namespace"))
			kind = "module";
		else if (type.includes("type_alias")) kind = "type";
		if (!kind) return;
		tags.push({
			role: "definition",
			kind,
			name: nameNode.text,
			node,
			nameNode,
		});
	});
	return tags;
}

export class AstService {
	constructor(private readonly registry: AstRegistry = new AstLanguageRegistry()) {}

	supportsOperation(filePath: string, operation: string): boolean {
		return this.registry.supportsOperation(filePath, operation);
	}

	listLanguages(): AstLanguage[] {
		return this.registry.listLanguages();
	}

	languageForPath(filePath: string): AstLanguage | undefined {
		return this.registry.languageForPath(filePath);
	}

	parseFile(filePath: string): ParsedFile | null {
		return this.registry.parseFile(filePath);
	}

	parseSource(
		language: AstLanguage,
		source: string,
		absPath?: string,
	): AstDocument | null {
		return this.registry.parseSource(language, source, absPath);
	}

	parseIncludedRanges(
		language: AstLanguage,
		source: string,
		ranges: AstIncludedRange[],
		absPath?: string,
	): AstDocument | null {
		return this.registry.parseIncludedRanges(language, source, ranges, absPath);
	}

	parsePattern(filePath: string, source: string): AstPatternNode | null {
		const language = this.registry.languageForPath(filePath);
		return language ? this.registry.parsePattern(language, source) : null;
	}

	findPattern(filePath: string, patternSource: string): AstPatternMatch[] {
		const parsed = this.parseFile(filePath);
		if (!parsed) return [];
		const pattern = this.registry.parsePattern(parsed.config, patternSource);
		if (!pattern) return [];
		const document = this.registry.parseSource(
			parsed.config,
			parsed.source,
			parsed.absPath,
		);
		return document ? document.findAll(pattern) : [];
	}

	private getTags(parsed: ParsedFile): TagEntry[] {
		const query = this.registry.loadQuery(parsed.config, "tags");
		if (!query) return collectDeclarationLikeNodes(parsed.tree.rootNode);

		const tags: TagEntry[] = [];
		for (const match of query.matches(parsed.tree.rootNode)) {
			const roleCapture = match.captures.find(
				(capture) =>
					capture.name.startsWith("definition.") ||
					capture.name.startsWith("reference."),
			);
			const nameCapture = match.captures.find(
				(capture) => capture.name === "name",
			);
			if (!roleCapture || !nameCapture || !nameCapture.node.text) continue;

			const [role, kind] = roleCapture.name.split(".", 2) as [TagRole, string];
			if (!kind) continue;
			tags.push({
				role,
				kind,
				name: nameCapture.node.text,
				node: roleCapture.node,
				nameNode: nameCapture.node,
			});
		}

		return tags.length > 0
			? tags
			: collectDeclarationLikeNodes(parsed.tree.rootNode);
	}

	private getLocalCaptures(parsed: ParsedFile): LocalCapture[] {
		const query = this.registry.loadQuery(parsed.config, "locals");
		if (!query) return [];

		const captures: LocalCapture[] = [];
		for (const capture of query.captures(parsed.tree.rootNode)) {
			if (!capture.name.startsWith("local.")) continue;
			const [, kind] = capture.name.split(".", 2) as [string, LocalCaptureKind];
			if (!kind) continue;
			captures.push({
				kind,
				name: capture.node.text,
				node: capture.node,
			});
		}
		return captures;
	}

	private getContainingScopes(
		locals: LocalCapture[],
		node: WasmNode,
	): WasmNode[] {
		return locals
			.filter(
				(capture) =>
					capture.kind === "scope" && containsNode(capture.node, node),
			)
			.map((capture) => capture.node)
			.sort((a, b) => nodeSpan(a) - nodeSpan(b));
	}

	private findLocalDefinitionScope(
		locals: LocalCapture[],
		target: WasmNode,
	): WasmNode | null {
		for (const scope of this.getContainingScopes(locals, target)) {
			const hasDefinition = locals.some(
				(capture) =>
					capture.kind === "definition" &&
					capture.name === target.text &&
					containsNode(scope, capture.node),
			);
			if (hasDefinition) return scope;
		}
		return null;
	}

	private collectTextMatches(scope: WasmNode, text: string): WasmNode[] {
		const matches: WasmNode[] = [];
		visitTree(scope, (node) => {
			if (isIdentifierLike(node) && node.text === text) matches.push(node);
		});
		return matches;
	}

	private collectLocalMatches(
		locals: LocalCapture[],
		scope: WasmNode,
		text: string,
	): LocalCapture[] {
		return locals.filter(
			(capture) =>
				capture.name === text &&
				capture.kind !== "scope" &&
				containsNode(scope, capture.node),
		);
	}

	getDiagnostics(filePath: string): Diagnostic[] {
		const parsed = this.parseFile(filePath);
		if (!parsed) return [];

		const diagnostics: Diagnostic[] = [];
		visitTree(parsed.tree.rootNode, (node) => {
			if (!node.isError && !node.isMissing) return;

			diagnostics.push({
				range: toRange(node),
				message: syntaxDiagnosticMessage(node),
				severity: DiagnosticSeverity.Error,
				source: "tree-sitter",
			});
			return true;
		});

		const seen = new Set<string>();
		return diagnostics.filter((diagnostic) => {
			const key = `${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.range.end.line}:${diagnostic.range.end.character}:${diagnostic.message}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	getDocumentSymbols(filePath: string): DocumentSymbol[] {
		const markdown = parseMarkdownFile(filePath);
		if (markdown) return markdownDocumentSymbols(markdown);

		const parsed = this.parseFile(filePath);
		if (!parsed) return [];

		const symbols = this.getTags(parsed)
			.filter((tag) => tag.role === "definition")
			.map(
				(tag) =>
					({
						name: tag.name,
						kind: symbolKindFromTag(tag.kind),
						range: toRange(tag.node),
						selectionRange: toRange(tag.nameNode),
						children: [],
					}) satisfies DocumentSymbol,
			);

		const seen = new Set<string>();
		return symbols.filter((symbol) => {
			const key = `${symbol.name}:${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}:${symbol.kind}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	getWorkspaceSymbols(rootPath: string, query = ""): SymbolInformation[] {
		const needle = query.trim().toLowerCase();
		const symbols: SymbolInformation[] = [];

		for (const filePath of collectWorkspaceFiles(rootPath)) {
			const markdown = parseMarkdownFile(filePath);
			if (markdown) {
				for (const heading of markdown.headings) {
					if (needle && !heading.text.toLowerCase().includes(needle)) continue;
					symbols.push({
						name: heading.text,
						kind: markdownSymbolKind(),
						location: {
							uri: pathToFileURL(markdown.absPath).href,
							range: markdownSelectionRange(
								heading.line,
								heading.startCharacter,
								heading.endCharacter,
							),
						},
						containerName: path.relative(
							path.dirname(path.resolve(rootPath)),
							markdown.absPath,
						),
					});
				}
				continue;
			}

			const parsed = this.parseFile(filePath);
			if (!parsed) continue;

			for (const tag of this.getTags(parsed)) {
				if (tag.role !== "definition") continue;
				if (needle && !tag.name.toLowerCase().includes(needle)) continue;
				symbols.push({
					name: tag.name,
					kind: symbolKindFromTag(tag.kind),
					location: nodeToLocation(parsed.absPath, tag.nameNode),
					containerName: path.relative(
						path.dirname(path.resolve(rootPath)),
						parsed.absPath,
					),
				});
			}
		}

		const seen = new Set<string>();
		return symbols.filter((symbol) => {
			const key = `${symbol.name}:${symbol.location.uri}:${symbol.location.range.start.line}:${symbol.location.range.start.character}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	getFoldingRanges(filePath: string): FoldingRange[] {
		const markdown = parseMarkdownFile(filePath);
		if (markdown) {
			const ranges = [
				...markdown.headings
					.filter((heading) => heading.endLine > heading.line)
					.map((heading) => ({
						startLine: heading.line,
						endLine: heading.endLine,
					})),
				...markdown.fences
					.filter((fence) => fence.endLine > fence.startLine)
					.map((fence) => ({
						startLine: fence.startLine,
						endLine: fence.endLine,
					})),
			];

			const seen = new Set<string>();
			return ranges.filter((range) => {
				const key = `${range.startLine}:${range.endLine}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		}

		const parsed = this.parseFile(filePath);
		if (!parsed) return [];

		const ranges: FoldingRange[] = [];
		visitTree(parsed.tree.rootNode, (node) => {
			const lineSpan = node.endPosition.row - node.startPosition.row;
			if (lineSpan < 1) return;

			const looksFoldable =
				node.namedChildCount > 0 &&
				/block|body|class|interface|function|method|statement|object|array|tuple|parameters|arguments|dictionary|list|module/i.test(
					node.type,
				);
			if (!looksFoldable) return;

			ranges.push({
				startLine: node.startPosition.row,
				endLine: node.endPosition.row,
			});
		});

		const seen = new Set<string>();
		return ranges.filter((range) => {
			const key = `${range.startLine}:${range.endLine}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	getDocumentHighlights(
		filePath: string,
		line: number,
		character: number,
	): DocumentHighlight[] {
		const markdown = parseMarkdownFile(filePath);
		if (markdown) {
			const heading = findMarkdownHeadingAtPosition(markdown, line, character);
			if (heading) {
				const references = [
					markdownHeadingLocation(markdown, heading),
					...markdown.inlineLinks
						.filter(
							(link) =>
								link.target.startsWith("#") &&
								slugifyMarkdownHeading(heading.text) ===
									link.target.slice(1).toLowerCase(),
						)
						.map((link) => markdownInlineLinkLocation(markdown, link)),
				];
				return references.map((location, index) => ({
					range: location.range,
					kind:
						index === 0
							? DocumentHighlightKind.Write
							: DocumentHighlightKind.Read,
				}));
			}

			const definition = findMarkdownReferenceDefinitionAtPosition(
				markdown,
				line,
				character,
			);
			const usage = definition
				? undefined
				: findMarkdownReferenceUsageAtPosition(markdown, line, character);
			const label = definition?.label ?? usage?.label;
			if (label) {
				const locations = uniqLocations([
					...markdown.referenceDefinitions
						.filter((item) => item.label === label)
						.map((item) => markdownReferenceDefinitionLocation(markdown, item)),
					...markdown.referenceUsages
						.filter((item) => item.label === label)
						.map((item) => markdownReferenceUsageLocation(markdown, item)),
				]);
				return locations.map((location, index) => ({
					range: location.range,
					kind:
						index === 0
							? DocumentHighlightKind.Write
							: DocumentHighlightKind.Read,
				}));
			}

			return [];
		}

		const parsed = this.parseFile(filePath);
		if (!parsed) return [];

		const target = findNamedNodeAtPosition(
			parsed.tree.rootNode,
			line,
			character,
		);
		if (!target || !isIdentifierLike(target)) return [];

		const locals = this.getLocalCaptures(parsed);
		const definitionScope = this.findLocalDefinitionScope(locals, target);
		if (definitionScope) {
			return this.collectLocalMatches(locals, definitionScope, target.text).map(
				(capture) => ({
					range: toRange(capture.node),
					kind:
						capture.kind === "definition"
							? DocumentHighlightKind.Write
							: DocumentHighlightKind.Read,
				}),
			);
		}

		const fallbackScope =
			closestNodeOfTypes(target, [
				"function_declaration",
				"function_definition",
				"function_expression",
				"arrow_function",
				"method_definition",
				"class_definition",
				"class_declaration",
				"module",
			]) ?? parsed.tree.rootNode;

		return this.collectTextMatches(fallbackScope, target.text).map((node) => ({
			range: toRange(node),
			kind: DocumentHighlightKind.Text,
		}));
	}

	getDefinition(filePath: string, line: number, character: number): Location[] {
		const markdown = parseMarkdownFile(filePath);
		if (markdown) {
			const link = findMarkdownInlineLinkAtPosition(markdown, line, character);
			if (link?.target.startsWith("#")) {
				const heading = findMarkdownHeadingBySlug(markdown, link.target);
				return heading ? [markdownHeadingLocation(markdown, heading)] : [];
			}

			const usage = findMarkdownReferenceUsageAtPosition(
				markdown,
				line,
				character,
			);
			if (usage) {
				return markdown.referenceDefinitions
					.filter((definition) => definition.label === usage.label)
					.map((definition) =>
						markdownReferenceDefinitionLocation(markdown, definition),
					);
			}

			const definition = findMarkdownReferenceDefinitionAtPosition(
				markdown,
				line,
				character,
			);
			if (definition)
				return [markdownReferenceDefinitionLocation(markdown, definition)];
			return [];
		}

		const parsed = this.parseFile(filePath);
		if (!parsed) return [];

		const target = findNamedNodeAtPosition(
			parsed.tree.rootNode,
			line,
			character,
		);
		if (!target || !isIdentifierLike(target)) return [];

		const locals = this.getLocalCaptures(parsed);
		const definitionScope = this.findLocalDefinitionScope(locals, target);
		if (definitionScope) {
			const localDefinitions = this.collectLocalMatches(
				locals,
				definitionScope,
				target.text,
			)
				.filter((capture) => capture.kind === "definition")
				.sort(
					(a, b) =>
						Math.abs(a.node.startIndex - target.startIndex) -
						Math.abs(b.node.startIndex - target.startIndex),
				);
			if (localDefinitions.length > 0) {
				return localDefinitions.map((capture) =>
					nodeToLocation(parsed.absPath, capture.node),
				);
			}
		}

		const definitions = this.getTags(parsed)
			.filter((tag) => tag.role === "definition" && tag.name === target.text)
			.sort(
				(a, b) =>
					Math.abs(a.nameNode.startIndex - target.startIndex) -
					Math.abs(b.nameNode.startIndex - target.startIndex),
			);
		return definitions.map((tag) =>
			nodeToLocation(parsed.absPath, tag.nameNode),
		);
	}

	getReferences(filePath: string, line: number, character: number): Location[] {
		const markdown = parseMarkdownFile(filePath);
		if (markdown) {
			const heading = findMarkdownHeadingAtPosition(markdown, line, character);
			if (heading) {
				return uniqLocations([
					markdownHeadingLocation(markdown, heading),
					...markdown.inlineLinks
						.filter(
							(link) =>
								link.target.startsWith("#") &&
								slugifyMarkdownHeading(heading.text) ===
									link.target.slice(1).toLowerCase(),
						)
						.map((link) => markdownInlineLinkLocation(markdown, link)),
				]);
			}

			const link = findMarkdownInlineLinkAtPosition(markdown, line, character);
			if (link?.target.startsWith("#")) {
				const targetHeading = findMarkdownHeadingBySlug(markdown, link.target);
				return targetHeading
					? uniqLocations([
							markdownHeadingLocation(markdown, targetHeading),
							...markdown.inlineLinks
								.filter((item) => item.target === link.target)
								.map((item) => markdownInlineLinkLocation(markdown, item)),
						])
					: [markdownInlineLinkLocation(markdown, link)];
			}

			const definition = findMarkdownReferenceDefinitionAtPosition(
				markdown,
				line,
				character,
			);
			const usage = definition
				? undefined
				: findMarkdownReferenceUsageAtPosition(markdown, line, character);
			const label = definition?.label ?? usage?.label;
			if (label) {
				return uniqLocations([
					...markdown.referenceDefinitions
						.filter((item) => item.label === label)
						.map((item) => markdownReferenceDefinitionLocation(markdown, item)),
					...markdown.referenceUsages
						.filter((item) => item.label === label)
						.map((item) => markdownReferenceUsageLocation(markdown, item)),
				]);
			}

			return [];
		}

		const parsed = this.parseFile(filePath);
		if (!parsed) return [];

		const target = findNamedNodeAtPosition(
			parsed.tree.rootNode,
			line,
			character,
		);
		if (!target || !isIdentifierLike(target)) return [];

		const locals = this.getLocalCaptures(parsed);
		const definitionScope = this.findLocalDefinitionScope(locals, target);
		if (definitionScope) {
			return this.collectLocalMatches(locals, definitionScope, target.text).map(
				(capture) => nodeToLocation(parsed.absPath, capture.node),
			);
		}

		const tagReferences = this.getTags(parsed)
			.filter((tag) => tag.name === target.text)
			.map((tag) => nodeToLocation(parsed.absPath, tag.nameNode));
		if (tagReferences.length > 1) return tagReferences;

		const fallbackScope = parsed.tree.rootNode;
		const textReferences = this.collectTextMatches(
			fallbackScope,
			target.text,
		).map((node) => nodeToLocation(parsed.absPath, node));
		const combined = [...tagReferences, ...textReferences];
		const seen = new Set<string>();
		return combined.filter((location) => {
			const key = `${location.uri}:${location.range.start.line}:${location.range.start.character}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	getHover(filePath: string, line: number, character: number): Hover | null {
		const markdown = parseMarkdownFile(filePath);
		if (markdown) {
			const link = findMarkdownInlineLinkAtPosition(markdown, line, character);
			if (link) {
				if (link.target.startsWith("#")) {
					const heading = findMarkdownHeadingBySlug(markdown, link.target);
					if (heading) return markdownHover(`**Heading**\n\n${heading.text}`);
					return markdownHover(
						`**Fragment**\n\n${link.target}\n\n*Heading not found*`,
					);
				}
				if (/^[a-z]+:/i.test(link.target))
					return markdownHover(`**External link**\n\n${link.target}`);
				return markdownHover(`**Local link**\n\n${link.target}`);
			}

			const definition = findMarkdownReferenceDefinitionAtPosition(
				markdown,
				line,
				character,
			);
			const usage = definition
				? undefined
				: findMarkdownReferenceUsageAtPosition(markdown, line, character);
			const label = definition?.label ?? usage?.label;
			if (label) {
				const target = markdown.referenceDefinitions.find(
					(item) => item.label === label,
				);
				if (target) {
					const prefix = /^[a-z]+:/i.test(target.url)
						? "**External link**"
						: "**Reference link**";
					return markdownHover(`${prefix}\n\n${target.url}`);
				}
			}

			return null;
		}

		return null;
	}
}

let sharedAstService: AstService | null = null;

export function getOrCreateAstService(): AstService {
	if (!sharedAstService) sharedAstService = new AstService();
	return sharedAstService;
}
