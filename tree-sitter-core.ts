import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import TypeScript from "tree-sitter-typescript";
import * as fs from "node:fs";
import * as path from "node:path";
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

type LanguageModule = {
  name?: string;
  language: unknown;
  nodeTypeInfo?: unknown;
};

type SupportedLanguageId = "javascript" | "typescript" | "tsx" | "python";

type TagRole = "definition" | "reference";

type LocalCaptureKind = "scope" | "definition" | "reference";

interface LanguageConfig {
  id: SupportedLanguageId;
  extensions: string[];
  language: LanguageModule;
  tagsQueryPath?: string;
  localsQueryPath?: string;
}

interface ParsedFile {
  absPath: string;
  config: LanguageConfig;
  source: string;
  tree: Parser.Tree;
}

interface TagEntry {
  kind: string;
  name: string;
  node: Parser.SyntaxNode;
  nameNode: Parser.SyntaxNode;
  role: TagRole;
}

interface LocalCapture {
  kind: LocalCaptureKind;
  name: string;
  node: Parser.SyntaxNode;
}

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));

const LANGUAGE_CONFIGS: LanguageConfig[] = [
  {
    id: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    language: JavaScript as LanguageModule,
    tagsQueryPath: path.join(PACKAGE_ROOT, "node_modules", "tree-sitter-javascript", "queries", "tags.scm"),
    localsQueryPath: path.join(PACKAGE_ROOT, "node_modules", "tree-sitter-javascript", "queries", "locals.scm"),
  },
  {
    id: "typescript",
    extensions: [".ts", ".mts", ".cts"],
    language: TypeScript.typescript as LanguageModule,
    tagsQueryPath: path.join(PACKAGE_ROOT, "node_modules", "tree-sitter-typescript", "queries", "tags.scm"),
    localsQueryPath: path.join(PACKAGE_ROOT, "node_modules", "tree-sitter-typescript", "queries", "locals.scm"),
  },
  {
    id: "tsx",
    extensions: [".tsx"],
    language: TypeScript.tsx as LanguageModule,
    tagsQueryPath: path.join(PACKAGE_ROOT, "node_modules", "tree-sitter-typescript", "queries", "tags.scm"),
    localsQueryPath: path.join(PACKAGE_ROOT, "node_modules", "tree-sitter-typescript", "queries", "locals.scm"),
  },
  {
    id: "python",
    extensions: [".py", ".pyi"],
    language: Python as LanguageModule,
    tagsQueryPath: path.join(PACKAGE_ROOT, "node_modules", "tree-sitter-python", "queries", "tags.scm"),
  },
];

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
    .filter((line) => !line.includes("#strip!") && !line.includes("#select-adjacent!"))
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

interface ParsedMarkdownFile {
  absPath: string;
  lines: string[];
  headings: MarkdownHeading[];
  fences: MarkdownFence[];
  referenceDefinitions: MarkdownReferenceDefinition[];
  referenceUsages: MarkdownReferenceUsage[];
  inlineLinks: MarkdownInlineLink[];
}

function isMarkdownFile(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function markdownSupportsOperation(operation: string): boolean {
  return operation === "goToDefinition"
    || operation === "findReferences"
    || operation === "hover"
    || operation === "documentHighlight"
    || operation === "documentSymbol"
    || operation === "workspaceSymbol"
    || operation === "foldingRange";
}

function getLanguageConfig(filePath: string): LanguageConfig | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_CONFIGS.find((config) => config.extensions.includes(ext));
}

function toPoint(line: number, character: number): Parser.Point {
  return {
    row: Math.max(0, line - 1),
    column: Math.max(0, character - 1),
  };
}

function toRange(node: Parser.SyntaxNode) {
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

function pointInNode(node: Parser.SyntaxNode, point: Parser.Point): boolean {
  const startBefore = node.startPosition.row < point.row
    || (node.startPosition.row === point.row && node.startPosition.column <= point.column);
  const endAfter = node.endPosition.row > point.row
    || (node.endPosition.row === point.row && node.endPosition.column >= point.column);
  return startBefore && endAfter;
}

function containsNode(outer: Parser.SyntaxNode, inner: Parser.SyntaxNode): boolean {
  return outer.startIndex <= inner.startIndex && outer.endIndex >= inner.endIndex;
}

function nodeSpan(node: Parser.SyntaxNode): number {
  return node.endIndex - node.startIndex;
}

function isIdentifierLike(node: Parser.SyntaxNode | null | undefined): boolean {
  if (!node || !node.isNamed) return false;
  return /^[A-Za-z_$][\w$]*$/.test(node.text);
}

function nodeToLocation(absPath: string, node: Parser.SyntaxNode): Location {
  return {
    uri: pathToFileURL(absPath).href,
    range: toRange(node),
  };
}

function markdownSelectionRange(line: number, startCharacter: number, endCharacter: number) {
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

function markdownLocation(absPath: string, line: number, startCharacter: number, endCharacter: number): Location {
  return {
    uri: pathToFileURL(absPath).href,
    range: markdownSelectionRange(line, startCharacter, endCharacter),
  };
}

function isMarkdownPosition(line: number, character: number, targetLine: number, startCharacter: number, endCharacter: number): boolean {
  return line - 1 === targetLine && character - 1 >= startCharacter && character - 1 <= endCharacter;
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
  const withoutTitle = trimmed.match(/^<([^>]+)>$/)?.[1]
    ?? trimmed.match(/^([^\s]+)(?:\s+.+)?$/)?.[1]
    ?? trimmed;
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
  const headings: MarkdownHeading[] = [];
  const fences: MarkdownFence[] = [];
  const referenceDefinitions: MarkdownReferenceDefinition[] = [];
  const referenceUsages: MarkdownReferenceUsage[] = [];
  const inlineLinks: MarkdownInlineLink[] = [];
  let activeFence: { marker: string; length: number; startLine: number } | null = null;

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

    const atxMatch = line.match(/^(\s{0,3})(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (atxMatch) {
      const prefix = atxMatch[1] ?? "";
      const hashes = atxMatch[2] ?? "#";
      const text = (atxMatch[3] ?? "").trim();
      if (!text) continue;
      const startCharacter = prefix.length + hashes.length + 1;
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
      const text = line.trim();
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

    const referenceDefinitionMatch = line.match(/^\s{0,3}\[([^\]]+)\]:\s*(\S+)/);
    if (referenceDefinitionMatch) {
      const label = referenceDefinitionMatch[1] ?? "";
      const url = cleanMarkdownLinkTarget(referenceDefinitionMatch[2] ?? "");
      const labelStartCharacter = line.indexOf("[") + 1;
      const labelEndCharacter = labelStartCharacter + label.length;
      const urlStartCharacter = line.indexOf(referenceDefinitionMatch[2] ?? url, labelEndCharacter);
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

  const lastContentLine = (() => {
    for (let index = lines.length - 1; index >= 0; index--) {
      if ((lines[index] ?? "").trim()) return index;
    }
    return 0;
  })();

  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]!;
    const nextBoundary = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    heading.endLine = Math.max(heading.line, Math.min(nextBoundary ? nextBoundary.line - 1 : lastContentLine, lastContentLine));
  }

  return { absPath, lines, headings, fences, referenceDefinitions, referenceUsages, inlineLinks };
}

function findMarkdownHeadingAtPosition(parsed: ParsedMarkdownFile, line: number, character: number): MarkdownHeading | undefined {
  return parsed.headings.find((heading) => isMarkdownPosition(line, character, heading.line, heading.startCharacter, heading.endCharacter));
}

function findMarkdownInlineLinkAtPosition(parsed: ParsedMarkdownFile, line: number, character: number): MarkdownInlineLink | undefined {
  return parsed.inlineLinks.find((link) => isMarkdownPosition(line, character, link.line, link.startCharacter, link.endCharacter));
}

function findMarkdownReferenceUsageAtPosition(parsed: ParsedMarkdownFile, line: number, character: number): MarkdownReferenceUsage | undefined {
  return parsed.referenceUsages.find((usage) => isMarkdownPosition(line, character, usage.line, usage.startCharacter, usage.endCharacter));
}

function findMarkdownReferenceDefinitionAtPosition(parsed: ParsedMarkdownFile, line: number, character: number): MarkdownReferenceDefinition | undefined {
  return parsed.referenceDefinitions.find((definition) =>
    isMarkdownPosition(line, character, definition.line, definition.labelStartCharacter, definition.labelEndCharacter)
    || isMarkdownPosition(line, character, definition.line, definition.urlStartCharacter, definition.urlEndCharacter));
}

function findMarkdownHeadingBySlug(parsed: ParsedMarkdownFile, slug: string): MarkdownHeading | undefined {
  const normalizedSlug = slug.replace(/^#/, "").toLowerCase();
  return parsed.headings.find((heading) => slugifyMarkdownHeading(heading.text) === normalizedSlug);
}

function markdownHeadingLocation(parsed: ParsedMarkdownFile, heading: MarkdownHeading): Location {
  return markdownLocation(parsed.absPath, heading.line, heading.startCharacter, heading.endCharacter);
}

function markdownReferenceDefinitionLocation(parsed: ParsedMarkdownFile, definition: MarkdownReferenceDefinition): Location {
  return markdownLocation(parsed.absPath, definition.line, definition.labelStartCharacter, definition.labelEndCharacter);
}

function markdownReferenceUsageLocation(parsed: ParsedMarkdownFile, usage: MarkdownReferenceUsage): Location {
  return markdownLocation(parsed.absPath, usage.line, usage.startCharacter, usage.endCharacter);
}

function markdownInlineLinkLocation(parsed: ParsedMarkdownFile, link: MarkdownInlineLink): Location {
  return markdownLocation(parsed.absPath, link.line, link.startCharacter, link.endCharacter);
}

function shouldSkipWorkspaceDir(dirName: string): boolean {
  return IGNORED_WORKSPACE_DIRS.has(dirName);
}

function collectWorkspaceFiles(rootPath: string, limit = MAX_WORKSPACE_SYMBOL_FILES): string[] {
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
      if (entry.isFile() && (getLanguageConfig(fullPath) || isMarkdownFile(fullPath))) files.push(fullPath);
    }
  }

  return files;
}

function visitTree(node: Parser.SyntaxNode, visitor: (node: Parser.SyntaxNode) => boolean | void): void {
  const shouldSkipChildren = visitor(node);
  if (shouldSkipChildren) return;
  for (const child of node.children) visitTree(child, visitor);
}

function findNamedNodeAtPosition(root: Parser.SyntaxNode, line: number, character: number): Parser.SyntaxNode | null {
  const point = toPoint(line, character);
  let node: Parser.SyntaxNode | null = root.namedDescendantForPosition(point);
  if (isIdentifierLike(node)) return node;

  while (node && !isIdentifierLike(node)) {
    const child = node.namedChildren.find((candidate: Parser.SyntaxNode) => pointInNode(candidate, point) && isIdentifierLike(candidate));
    if (child) return child;
    node = node.parent;
  }

  return isIdentifierLike(node) ? node : null;
}

function syntaxDiagnosticMessage(node: Parser.SyntaxNode): string {
  if (node.isMissing) return `Missing ${node.type}`;
  const snippet = node.text.replace(/\s+/g, " ").trim();
  if (!snippet) return "Syntax error";
  return `Syntax error near '${snippet.slice(0, 40)}'`;
}

function symbolKindFromTag(kind: string): SymbolKind {
  switch (kind) {
    case "class": return SymbolKind.Class;
    case "interface": return SymbolKind.Interface;
    case "method": return SymbolKind.Method;
    case "function": return SymbolKind.Function;
    case "module": return SymbolKind.Module;
    case "constant": return SymbolKind.Constant;
    case "type": return SymbolKind.Class;
    case "call": return SymbolKind.Function;
    default: return SymbolKind.Variable;
  }
}

function collectDeclarationLikeNodes(root: Parser.SyntaxNode): TagEntry[] {
  const tags: TagEntry[] = [];
  visitTree(root, (node) => {
    const nameNode = node.childForFieldName("name");
    if (!nameNode || !isIdentifierLike(nameNode)) return;
    const type = node.type;
    let kind: string | null = null;
    if (type.includes("class")) kind = "class";
    else if (type.includes("interface")) kind = "interface";
    else if (type.includes("method")) kind = "method";
    else if (type.includes("function") || type.includes("lambda")) kind = "function";
    else if (type.includes("module") || type.includes("namespace")) kind = "module";
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

export class TreeSitterManager {
  private parsers = new Map<SupportedLanguageId, Parser>();
  private queries = new Map<string, Parser.Query | null>();

  supportsOperation(filePath: string, operation: string): boolean {
    if (isMarkdownFile(filePath)) return markdownSupportsOperation(operation);
    const config = getLanguageConfig(filePath);
    if (!config) return false;
    return SUPPORTED_OPERATIONS.has(operation as TreeSitterOperation);
  }

  private getParser(config: LanguageConfig): Parser {
    const existing = this.parsers.get(config.id);
    if (existing) return existing;
    const parser = new Parser();
    parser.setLanguage(config.language);
    this.parsers.set(config.id, parser);
    return parser;
  }

  private parseFile(filePath: string): ParsedFile | null {
    const absPath = path.resolve(filePath);
    const config = getLanguageConfig(absPath);
    if (!config) return null;

    let source: string;
    try {
      source = fs.readFileSync(absPath, "utf-8");
    } catch {
      return null;
    }

    const tree = this.getParser(config).parse(source);
    return { absPath, config, source, tree };
  }

  private loadQuery(config: LanguageConfig, kind: "tags" | "locals"): Parser.Query | null {
    const queryPath = kind === "tags" ? config.tagsQueryPath : config.localsQueryPath;
    if (!queryPath || !fs.existsSync(queryPath)) return null;

    const cacheKey = `${config.id}:${kind}`;
    if (this.queries.has(cacheKey)) return this.queries.get(cacheKey) ?? null;

    try {
      const source = sanitizeQuerySource(fs.readFileSync(queryPath, "utf-8"));
      const query = new Parser.Query(config.language, source);
      this.queries.set(cacheKey, query);
      return query;
    } catch {
      this.queries.set(cacheKey, null);
      return null;
    }
  }

  private getTags(parsed: ParsedFile): TagEntry[] {
    const query = this.loadQuery(parsed.config, "tags");
    if (!query) return collectDeclarationLikeNodes(parsed.tree.rootNode);

    const tags: TagEntry[] = [];
    for (const match of query.matches(parsed.tree.rootNode)) {
      const roleCapture = match.captures.find((capture) => capture.name.startsWith("definition.") || capture.name.startsWith("reference."));
      const nameCapture = match.captures.find((capture) => capture.name === "name");
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

    return tags.length > 0 ? tags : collectDeclarationLikeNodes(parsed.tree.rootNode);
  }

  private getLocalCaptures(parsed: ParsedFile): LocalCapture[] {
    const query = this.loadQuery(parsed.config, "locals");
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

  private getContainingScopes(locals: LocalCapture[], node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    return locals
      .filter((capture) => capture.kind === "scope" && containsNode(capture.node, node))
      .map((capture) => capture.node)
      .sort((a, b) => nodeSpan(a) - nodeSpan(b));
  }

  private findLocalDefinitionScope(locals: LocalCapture[], target: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (const scope of this.getContainingScopes(locals, target)) {
      const hasDefinition = locals.some((capture) => capture.kind === "definition" && capture.name === target.text && containsNode(scope, capture.node));
      if (hasDefinition) return scope;
    }
    return null;
  }

  private collectTextMatches(scope: Parser.SyntaxNode, text: string): Parser.SyntaxNode[] {
    const matches: Parser.SyntaxNode[] = [];
    visitTree(scope, (node) => {
      if (isIdentifierLike(node) && node.text === text) matches.push(node);
    });
    return matches;
  }

  private collectLocalMatches(locals: LocalCapture[], scope: Parser.SyntaxNode, text: string): LocalCapture[] {
    return locals.filter((capture) => capture.name === text && capture.kind !== "scope" && containsNode(scope, capture.node));
  }

  getDiagnostics(filePath: string): Diagnostic[] {
    const parsed = this.parseFile(filePath);
    if (!parsed) return [];

    const diagnostics: Diagnostic[] = [];
    visitTree(parsed.tree.rootNode, (node) => {
      if (!node.isError && !node.isMissing)
        return;

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
    if (markdown) {
      const roots: Array<DocumentSymbol & { _level?: number }> = [];
      const stack: Array<DocumentSymbol & { _level?: number }> = [];

      for (const heading of markdown.headings) {
        const symbol: DocumentSymbol & { _level?: number } = {
          name: heading.text,
          kind: markdownSymbolKind(),
          range: markdownRange(markdown.lines, heading),
          selectionRange: markdownSelectionRange(heading.line, heading.startCharacter, heading.endCharacter),
          children: [],
          _level: heading.level,
        };

        while (stack.length > 0 && (stack[stack.length - 1]!._level ?? 0) >= heading.level) stack.pop();
        if (stack.length === 0) roots.push(symbol);
        else stack[stack.length - 1]!.children!.push(symbol);
        stack.push(symbol);
      }

      const stripLevel = (symbols: Array<DocumentSymbol & { _level?: number }>): DocumentSymbol[] => symbols.map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        range: symbol.range,
        selectionRange: symbol.selectionRange,
        children: stripLevel((symbol.children as Array<DocumentSymbol & { _level?: number }> | undefined) ?? []),
      }));

      return stripLevel(roots);
    }

    const parsed = this.parseFile(filePath);
    if (!parsed) return [];

    const symbols = this.getTags(parsed)
      .filter((tag) => tag.role === "definition")
      .map((tag) => ({
        name: tag.name,
        kind: symbolKindFromTag(tag.kind),
        range: toRange(tag.node),
        selectionRange: toRange(tag.nameNode),
        children: [],
      } satisfies DocumentSymbol));

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
              range: markdownSelectionRange(heading.line, heading.startCharacter, heading.endCharacter),
            },
            containerName: path.relative(path.dirname(path.resolve(rootPath)), markdown.absPath),
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
          containerName: path.relative(path.dirname(path.resolve(rootPath)), parsed.absPath),
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
          .map((heading) => ({ startLine: heading.line, endLine: heading.endLine })),
        ...markdown.fences
          .filter((fence) => fence.endLine > fence.startLine)
          .map((fence) => ({ startLine: fence.startLine, endLine: fence.endLine })),
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

      const looksFoldable = node.namedChildCount > 0 && /block|body|class|interface|function|method|statement|object|array|tuple|parameters|arguments|dictionary|list|module/i.test(node.type);
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

  getDocumentHighlights(filePath: string, line: number, character: number): DocumentHighlight[] {
    const markdown = parseMarkdownFile(filePath);
    if (markdown) {
      const heading = findMarkdownHeadingAtPosition(markdown, line, character);
      if (heading) {
        const references = [
          markdownHeadingLocation(markdown, heading),
          ...markdown.inlineLinks
            .filter((link) => link.target.startsWith("#") && slugifyMarkdownHeading(heading.text) === link.target.slice(1).toLowerCase())
            .map((link) => markdownInlineLinkLocation(markdown, link)),
        ];
        return references.map((location, index) => ({
          range: location.range,
          kind: index === 0 ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
        }));
      }

      const definition = findMarkdownReferenceDefinitionAtPosition(markdown, line, character);
      const usage = definition ? undefined : findMarkdownReferenceUsageAtPosition(markdown, line, character);
      const label = definition?.label ?? usage?.label;
      if (label) {
        const locations = uniqLocations([
          ...markdown.referenceDefinitions.filter((item) => item.label === label).map((item) => markdownReferenceDefinitionLocation(markdown, item)),
          ...markdown.referenceUsages.filter((item) => item.label === label).map((item) => markdownReferenceUsageLocation(markdown, item)),
        ]);
        return locations.map((location, index) => ({
          range: location.range,
          kind: index === 0 ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
        }));
      }

      return [];
    }

    const parsed = this.parseFile(filePath);
    if (!parsed) return [];

    const target = findNamedNodeAtPosition(parsed.tree.rootNode, line, character);
    if (!target || !isIdentifierLike(target)) return [];

    const locals = this.getLocalCaptures(parsed);
    const definitionScope = this.findLocalDefinitionScope(locals, target);
    if (definitionScope) {
      return this.collectLocalMatches(locals, definitionScope, target.text).map((capture) => ({
        range: toRange(capture.node),
        kind: capture.kind === "definition" ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
      }));
    }

    const fallbackScope = target.closest([
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

      const usage = findMarkdownReferenceUsageAtPosition(markdown, line, character);
      if (usage) {
        return markdown.referenceDefinitions
          .filter((definition) => definition.label === usage.label)
          .map((definition) => markdownReferenceDefinitionLocation(markdown, definition));
      }

      const definition = findMarkdownReferenceDefinitionAtPosition(markdown, line, character);
      if (definition) return [markdownReferenceDefinitionLocation(markdown, definition)];
      return [];
    }

    const parsed = this.parseFile(filePath);
    if (!parsed) return [];

    const target = findNamedNodeAtPosition(parsed.tree.rootNode, line, character);
    if (!target || !isIdentifierLike(target)) return [];

    const locals = this.getLocalCaptures(parsed);
    const definitionScope = this.findLocalDefinitionScope(locals, target);
    if (definitionScope) {
      const localDefinitions = this.collectLocalMatches(locals, definitionScope, target.text)
        .filter((capture) => capture.kind === "definition")
        .sort((a, b) => Math.abs(a.node.startIndex - target.startIndex) - Math.abs(b.node.startIndex - target.startIndex));
      if (localDefinitions.length > 0) {
        return localDefinitions.map((capture) => nodeToLocation(parsed.absPath, capture.node));
      }
    }

    const definitions = this.getTags(parsed)
      .filter((tag) => tag.role === "definition" && tag.name === target.text)
      .sort((a, b) => Math.abs(a.nameNode.startIndex - target.startIndex) - Math.abs(b.nameNode.startIndex - target.startIndex));
    return definitions.map((tag) => nodeToLocation(parsed.absPath, tag.nameNode));
  }

  getReferences(filePath: string, line: number, character: number): Location[] {
    const markdown = parseMarkdownFile(filePath);
    if (markdown) {
      const heading = findMarkdownHeadingAtPosition(markdown, line, character);
      if (heading) {
        return uniqLocations([
          markdownHeadingLocation(markdown, heading),
          ...markdown.inlineLinks
            .filter((link) => link.target.startsWith("#") && slugifyMarkdownHeading(heading.text) === link.target.slice(1).toLowerCase())
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

      const definition = findMarkdownReferenceDefinitionAtPosition(markdown, line, character);
      const usage = definition ? undefined : findMarkdownReferenceUsageAtPosition(markdown, line, character);
      const label = definition?.label ?? usage?.label;
      if (label) {
        return uniqLocations([
          ...markdown.referenceDefinitions.filter((item) => item.label === label).map((item) => markdownReferenceDefinitionLocation(markdown, item)),
          ...markdown.referenceUsages.filter((item) => item.label === label).map((item) => markdownReferenceUsageLocation(markdown, item)),
        ]);
      }

      return [];
    }

    const parsed = this.parseFile(filePath);
    if (!parsed) return [];

    const target = findNamedNodeAtPosition(parsed.tree.rootNode, line, character);
    if (!target || !isIdentifierLike(target)) return [];

    const locals = this.getLocalCaptures(parsed);
    const definitionScope = this.findLocalDefinitionScope(locals, target);
    if (definitionScope) {
      return this.collectLocalMatches(locals, definitionScope, target.text)
        .map((capture) => nodeToLocation(parsed.absPath, capture.node));
    }

    const tagReferences = this.getTags(parsed)
      .filter((tag) => tag.name === target.text)
      .map((tag) => nodeToLocation(parsed.absPath, tag.nameNode));
    if (tagReferences.length > 1) return tagReferences;

    const fallbackScope = parsed.tree.rootNode;
    const textReferences = this.collectTextMatches(fallbackScope, target.text)
      .map((node) => nodeToLocation(parsed.absPath, node));
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
          return markdownHover(`**Fragment**\n\n${link.target}\n\n*Heading not found*`);
        }
        if (/^[a-z]+:/i.test(link.target)) return markdownHover(`**External link**\n\n${link.target}`);
        return markdownHover(`**Local link**\n\n${link.target}`);
      }

      const definition = findMarkdownReferenceDefinitionAtPosition(markdown, line, character);
      const usage = definition ? undefined : findMarkdownReferenceUsageAtPosition(markdown, line, character);
      const label = definition?.label ?? usage?.label;
      if (label) {
        const target = markdown.referenceDefinitions.find((item) => item.label === label);
        if (target) {
          const prefix = /^[a-z]+:/i.test(target.url) ? "**External link**" : "**Reference link**";
          return markdownHover(`${prefix}\n\n${target.url}`);
        }
      }

      return null;
    }

    return null;
  }
}

let sharedTreeSitterManager: TreeSitterManager | null = null;

export function getOrCreateTreeSitterManager(): TreeSitterManager {
  if (!sharedTreeSitterManager) sharedTreeSitterManager = new TreeSitterManager();
  return sharedTreeSitterManager;
}
