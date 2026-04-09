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
  type Location,
  type SymbolInformation,
} from "vscode-languageserver-protocol";

export type TreeSitterOperation =
  | "diagnostics"
  | "goToDefinition"
  | "findReferences"
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
  "documentSymbol",
  "workspaceSymbol",
  "documentHighlight",
  "foldingRange",
]);

const MAX_WORKSPACE_SYMBOL_FILES = 400;
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
      if (entry.isFile() && getLanguageConfig(fullPath)) files.push(fullPath);
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
}

let sharedTreeSitterManager: TreeSitterManager | null = null;

export function getOrCreateTreeSitterManager(): TreeSitterManager {
  if (!sharedTreeSitterManager) sharedTreeSitterManager = new TreeSitterManager();
  return sharedTreeSitterManager;
}
