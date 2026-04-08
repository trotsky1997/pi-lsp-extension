import { open } from "node:fs/promises";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  CodeAction,
  Command,
  Diagnostic,
  DocumentHighlight,
  DocumentSymbol,
  FoldingRange,
  Hover,
  Location,
  LocationLink,
  SignatureHelp,
  SymbolInformation,
  WorkspaceEdit,
} from "vscode-languageserver-protocol";
import {
  filterDiagnosticsBySeverity,
  formatDiagnostic,
  getOrCreateManager,
  type SeverityFilter,
  uriToPath,
} from "./lsp-core.js";
import {
  formatDocumentHighlightResult,
  formatDocumentSymbolResult,
  formatFindReferencesResult,
  formatFoldingRangeResult,
  formatGoToDefinitionResult,
  formatHoverResult,
  formatIncomingCallsResult,
  formatOutgoingCallsResult,
  formatPrepareCallHierarchyResult,
  formatWorkspaceSymbolResult,
  toLocation,
} from "./lsp-tool-formatters.js";
import {
  OPERATIONS,
  parseLspToolInput,
  SEVERITY_FILTERS,
  type LspToolInput,
  type Operation,
} from "./lsp-tool-schemas.js";
import { getSymbolAtPosition } from "./lsp-tool-symbol-context.js";

const PREVIEW_LINES = 10;
const MAX_LSP_FILE_SIZE_BYTES = 10_000_000;
const DIAGNOSTICS_WAIT_MS_DEFAULT = 3000;

const LspParams = Type.Object({
  operation: StringEnum(OPERATIONS),
  filePath: Type.Optional(Type.String({ description: "Absolute or relative path to the file." })),
  filePaths: Type.Optional(Type.Array(Type.String(), { description: "File paths for workspaceDiagnostics." })),
  line: Type.Optional(Type.Number({ description: "1-based line number." })),
  character: Type.Optional(Type.Number({ description: "1-based character offset." })),
  endLine: Type.Optional(Type.Number({ description: "1-based end line for range operations." })),
  endCharacter: Type.Optional(Type.Number({ description: "1-based end character for range operations." })),
  newName: Type.Optional(Type.String({ description: "New symbol name for rename." })),
  severity: Type.Optional(StringEnum(SEVERITY_FILTERS, { description: 'Filter diagnostics: "all" | "error" | "warning" | "info" | "hint".' })),
});

type LspParamsType = LspToolInput;

interface LspResultDetails {
  fileCount?: number;
  filePath?: string;
  operation: Operation;
  resultCount?: number;
}

const OPERATION_LABELS: Record<Operation, { singular: string; plural: string; special?: string }> = {
  goToDefinition: { singular: "definition", plural: "definitions" },
  findReferences: { singular: "reference", plural: "references" },
  hover: { singular: "hover info", plural: "hover info", special: "available" },
  documentHighlight: { singular: "document highlight", plural: "document highlights" },
  documentSymbol: { singular: "symbol", plural: "symbols" },
  workspaceSymbol: { singular: "symbol", plural: "symbols" },
  goToImplementation: { singular: "implementation", plural: "implementations" },
  typeDefinition: { singular: "type definition", plural: "type definitions" },
  prepareCallHierarchy: { singular: "call item", plural: "call items" },
  incomingCalls: { singular: "caller", plural: "callers" },
  outgoingCalls: { singular: "callee", plural: "callees" },
  diagnostics: { singular: "diagnostic", plural: "diagnostics" },
  workspaceDiagnostics: { singular: "diagnostic", plural: "diagnostics" },
  signatureHelp: { singular: "signature", plural: "signatures" },
  rename: { singular: "rename edit", plural: "rename edits" },
  prepareRename: { singular: "rename target", plural: "rename targets" },
  foldingRange: { singular: "folding range", plural: "folding ranges" },
  codeAction: { singular: "code action", plural: "code actions" },
};

function diagnosticsWaitMsForFile(filePath: string): number {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".kt" || ext === ".kts") return 30000;
  if (ext === ".swift") return 20000;
  if (ext === ".rs") return 20000;
  return DIAGNOSTICS_WAIT_MS_DEFAULT;
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("aborted"));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function isAbortedError(error: unknown): boolean {
  return error instanceof Error && error.message === "aborted";
}

function cancelledToolResult(): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  return {
    content: [{ type: "text" as const, text: "Cancelled" }],
    details: { cancelled: true },
  };
}

type ExecuteArgs = {
  ctx: { cwd: string };
  onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }) => void) | undefined;
  signal: AbortSignal | undefined;
};

function isAbortSignalLike(value: unknown): value is AbortSignal {
  return !!value
    && typeof value === "object"
    && "aborted" in value
    && typeof (value as { aborted: unknown }).aborted === "boolean"
    && typeof (value as { addEventListener?: unknown }).addEventListener === "function";
}

function isContextLike(value: unknown): value is { cwd: string } {
  return !!value && typeof value === "object" && typeof (value as { cwd?: unknown }).cwd === "string";
}

function normalizeExecuteArgs(onUpdateArg: unknown, ctxArg: unknown, signalArg: unknown): ExecuteArgs {
  if (isContextLike(signalArg)) {
    return {
      signal: isAbortSignalLike(onUpdateArg) ? onUpdateArg : undefined,
      onUpdate: typeof ctxArg === "function" ? ctxArg as ExecuteArgs["onUpdate"] : undefined,
      ctx: signalArg,
    };
  }

  if (isContextLike(ctxArg)) {
    return {
      signal: isAbortSignalLike(signalArg) ? signalArg : undefined,
      onUpdate: typeof onUpdateArg === "function" ? onUpdateArg as ExecuteArgs["onUpdate"] : undefined,
      ctx: ctxArg,
    };
  }

  throw new Error("Invalid tool execution context");
}

function getAbsolutePath(filePath: string, cwd: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function countSymbols(symbols: DocumentSymbol[]): number {
  let count = symbols.length;
  for (const symbol of symbols) {
    count += countSymbols(symbol.children ?? []);
  }
  return count;
}

function countUniqueUris(uris: string[]): number {
  return new Set(uris.filter(Boolean)).size;
}

function countUniqueFilesFromLocations(locations: Array<Location | LocationLink>): number {
  return countUniqueUris(locations.map(location => toLocation(location).uri));
}

function countUniqueFilesFromCallItems(items: CallHierarchyItem[]): number {
  return countUniqueUris(items.map(item => item.uri));
}

function countUniqueFilesFromIncomingCalls(calls: CallHierarchyIncomingCall[]): number {
  return countUniqueUris(calls.map(call => call.from?.uri ?? ""));
}

function countUniqueFilesFromOutgoingCalls(calls: CallHierarchyOutgoingCall[]): number {
  return countUniqueUris(calls.map(call => call.to?.uri ?? ""));
}

function countWorkspaceEditChanges(edit: WorkspaceEdit | null | undefined): { fileCount: number; resultCount: number } {
  if (!edit) return { fileCount: 0, resultCount: 0 };

  let fileCount = 0;
  let resultCount = 0;

  if (edit.documentChanges?.length) {
    for (const change of edit.documentChanges as Array<{ edits?: unknown[] }>) {
      if (change.edits?.length) {
        fileCount += 1;
        resultCount += change.edits.length;
      }
    }
  }

  if (edit.changes) {
    for (const edits of Object.values(edit.changes) as Array<Array<{ newText: string; range: { start: { line: number; character: number } } }>>) {
      if (edits.length) {
        fileCount += 1;
        resultCount += edits.length;
      }
    }
  }

  return { fileCount, resultCount };
}

function formatSignature(help: SignatureHelp | null | undefined): string {
  if (!help?.signatures?.length) return "No signature help available.";
  const signature = help.signatures[help.activeSignature ?? 0] ?? help.signatures[0];
  let text = signature.label ?? "Signature";
  if (signature.documentation) {
    text += `\n${typeof signature.documentation === "string" ? signature.documentation : signature.documentation?.value ?? ""}`;
  }
  if (signature.parameters?.length) {
    const parameters = signature.parameters
      .map((parameter: { label: string | [number, number] }) => typeof parameter.label === "string"
        ? parameter.label
        : Array.isArray(parameter.label)
          ? parameter.label.join("-")
          : "")
      .filter(Boolean);
    if (parameters.length) text += `\nParameters: ${parameters.join(", ")}`;
  }
  return text;
}

function formatWorkspaceEdit(edit: WorkspaceEdit, cwd: string): string {
  const lines: string[] = [];

  if (edit.documentChanges?.length) {
    for (const change of edit.documentChanges as Array<{ textDocument?: { uri?: string }; edits?: Array<{ newText: string; range: { start: { line: number; character: number } } }> }>) {
      if (!change.textDocument?.uri) continue;
      const filePath = uriToPath(change.textDocument.uri);
      const display = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
      lines.push(`${display}:`);
      for (const item of change.edits ?? []) {
        lines.push(`  [${item.range.start.line + 1}:${item.range.start.character + 1}] -> ${JSON.stringify(item.newText)}`);
      }
    }
  }

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const filePath = uriToPath(uri);
      const display = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
      lines.push(`${display}:`);
      for (const item of edits) {
        lines.push(`  [${item.range.start.line + 1}:${item.range.start.character + 1}] -> ${JSON.stringify(item.newText)}`);
      }
    }
  }

  return lines.length ? lines.join("\n") : "No edits.";
}

function formatCodeActions(actions: Array<CodeAction | Command>): string {
  if (!actions.length) return "No code actions available.";
  return actions.map((action, index) => {
    const title = "title" in action && action.title ? action.title : "Untitled action";
    const kind = "kind" in action && action.kind ? ` (${action.kind})` : "";
    const preferred = "isPreferred" in action && action.isPreferred ? " *" : "";
    return `${index + 1}. ${title}${kind}${preferred}`;
  }).join("\n");
}
function buildOperationSummary(details: LspResultDetails): string | null {
  if (details.resultCount === undefined || details.fileCount === undefined) return null;
  const labelConfig = OPERATION_LABELS[details.operation];

  let summary = details.operation === "hover" && details.resultCount > 0 && labelConfig.special
    ? `Hover info ${labelConfig.special}`
    : `Found ${details.resultCount} ${details.resultCount === 1 ? labelConfig.singular : labelConfig.plural}`;

  if (details.fileCount > 1) summary += ` across ${details.fileCount} files`;
  return summary;
}

function buildResult(text: string, details: LspResultDetails | Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

async function ensureOpenFile(
  manager: ReturnType<typeof getOrCreateManager>,
  filePath: string,
  cwd: string,
): Promise<void> {
  if (manager.isFileOpen(filePath)) return;

  const absolutePath = getAbsolutePath(filePath, cwd);
  const handle = await open(absolutePath, "r");
  try {
    const stats = await handle.stat();
    if (stats.size > MAX_LSP_FILE_SIZE_BYTES) {
      throw new Error(`File too large for LSP analysis (${Math.ceil(stats.size / 1_000_000)}MB exceeds 10MB limit).`);
    }
    const content = await handle.readFile({ encoding: "utf-8" });
    const opened = await manager.openFile(absolutePath, content);
    if (!opened) {
      throw new Error(`No LSP server available for file type: ${path.extname(absolutePath) || "<unknown>"}`);
    }
  } finally {
    await handle.close();
  }
}

function formatOperationResult(
  operation: Operation,
  result: unknown,
  filePath: string | undefined,
  cwd: string,
): { details: LspResultDetails; text: string } {
  switch (operation) {
    case "goToDefinition": {
      const rawResults = Array.isArray(result) ? result as Array<Location | LocationLink> : result ? [result as Location | LocationLink] : [];
      return {
        text: formatGoToDefinitionResult(result as Location | Location[] | LocationLink | LocationLink[] | null, cwd),
        details: { operation, filePath, resultCount: rawResults.length, fileCount: countUniqueFilesFromLocations(rawResults) },
      };
    }
    case "findReferences": {
      const locations = (result as Location[] | null | undefined) ?? [];
      return {
        text: formatFindReferencesResult(locations, cwd),
        details: { operation, filePath, resultCount: locations.length, fileCount: countUniqueFilesFromLocations(locations) },
      };
    }
    case "hover": {
      const hover = result as Hover | null | undefined;
      return {
        text: formatHoverResult(hover),
        details: { operation, filePath, resultCount: hover ? 1 : 0, fileCount: hover ? 1 : 0 },
      };
    }
    case "documentHighlight": {
      const highlights = (result as DocumentHighlight[] | null | undefined) ?? [];
      return {
        text: formatDocumentHighlightResult(highlights),
        details: { operation, filePath, resultCount: highlights.length, fileCount: highlights.length > 0 ? 1 : 0 },
      };
    }
    case "documentSymbol": {
      const symbols = (result as Array<DocumentSymbol | SymbolInformation> | null | undefined) ?? [];
      const isFlat = symbols.length > 0 && "location" in symbols[0]!;
      return {
        text: formatDocumentSymbolResult(symbols as DocumentSymbol[] | SymbolInformation[], cwd),
        details: {
          operation,
          filePath,
          resultCount: isFlat ? symbols.length : countSymbols(symbols as DocumentSymbol[]),
          fileCount: symbols.length > 0 ? 1 : 0,
        },
      };
    }
    case "workspaceSymbol": {
      const symbols = (result as SymbolInformation[] | null | undefined) ?? [];
      return {
        text: formatWorkspaceSymbolResult(symbols, cwd),
        details: { operation, filePath, resultCount: symbols.length, fileCount: countUniqueUris(symbols.map(symbol => symbol.location?.uri ?? "")) },
      };
    }
    case "goToImplementation": {
      const locations = (result as Array<Location | LocationLink> | null | undefined) ?? [];
      return {
        text: formatGoToDefinitionResult(locations as Location[] | LocationLink[], cwd),
        details: { operation, filePath, resultCount: locations.length, fileCount: countUniqueFilesFromLocations(locations) },
      };
    }
    case "typeDefinition": {
      const locations = (result as Array<Location | LocationLink> | null | undefined) ?? [];
      return {
        text: formatGoToDefinitionResult(locations as Location[] | LocationLink[], cwd),
        details: { operation, filePath, resultCount: locations.length, fileCount: countUniqueFilesFromLocations(locations) },
      };
    }
    case "prepareCallHierarchy": {
      const items = (result as CallHierarchyItem[] | null | undefined) ?? [];
      return {
        text: formatPrepareCallHierarchyResult(items, cwd),
        details: { operation, filePath, resultCount: items.length, fileCount: countUniqueFilesFromCallItems(items) },
      };
    }
    case "incomingCalls": {
      const calls = (result as CallHierarchyIncomingCall[] | null | undefined) ?? [];
      return {
        text: formatIncomingCallsResult(calls, cwd),
        details: { operation, filePath, resultCount: calls.length, fileCount: countUniqueFilesFromIncomingCalls(calls) },
      };
    }
    case "outgoingCalls": {
      const calls = (result as CallHierarchyOutgoingCall[] | null | undefined) ?? [];
      return {
        text: formatOutgoingCallsResult(calls, cwd),
        details: { operation, filePath, resultCount: calls.length, fileCount: countUniqueFilesFromOutgoingCalls(calls) },
      };
    }
    case "signatureHelp": {
      const help = result as SignatureHelp | null | undefined;
      return {
        text: formatSignature(help),
        details: { operation, filePath, resultCount: help ? 1 : 0, fileCount: help ? 1 : 0 },
      };
    }
    case "rename": {
      const edit = result as WorkspaceEdit | null | undefined;
      const counts = countWorkspaceEditChanges(edit);
      return {
        text: edit ? formatWorkspaceEdit(edit, cwd) : "No rename available at this position.",
        details: { operation, filePath, resultCount: counts.resultCount, fileCount: counts.fileCount },
      };
    }
    case "prepareRename": {
      const renameTarget = result as { placeholder?: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } } | null | undefined;
      return {
        text: renameTarget
          ? `Rename available for ${renameTarget.range.start.line + 1}:${renameTarget.range.start.character + 1}-${renameTarget.range.end.line + 1}:${renameTarget.range.end.character + 1}${renameTarget.placeholder ? `\nPlaceholder: ${renameTarget.placeholder}` : ""}`
          : "Rename is not available at this position.",
        details: { operation, filePath, resultCount: renameTarget ? 1 : 0, fileCount: renameTarget ? 1 : 0 },
      };
    }
    case "foldingRange": {
      const ranges = (result as FoldingRange[] | null | undefined) ?? [];
      return {
        text: formatFoldingRangeResult(ranges),
        details: { operation, filePath, resultCount: ranges.length, fileCount: ranges.length > 0 ? 1 : 0 },
      };
    }
    case "codeAction": {
      const actions = (result as Array<CodeAction | Command> | null | undefined) ?? [];
      return {
        text: formatCodeActions(actions),
        details: { operation, filePath, resultCount: actions.length, fileCount: actions.length > 0 ? 1 : 0 },
      };
    }
    default:
      return {
        text: typeof result === "string" ? result : String(result),
        details: { operation, filePath },
      };
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "lsp",
    label: "LSP",
    description: `Claude-style LSP queries for definitions, references, hover, highlights, symbols, implementations, call hierarchy, and preserved Pi extras.

Core operations: goToDefinition, findReferences, hover, documentHighlight, documentSymbol, workspaceSymbol, goToImplementation, typeDefinition, prepareCallHierarchy, incomingCalls, outgoingCalls.
Extras: diagnostics, workspaceDiagnostics, signatureHelp, rename, prepareRename, foldingRange, codeAction.`,
    parameters: LspParams,

    async execute(_toolCallId: unknown, rawParams: unknown, onUpdateArg: unknown, ctxArg: unknown, signalArg: unknown): Promise<any> {
      const { ctx, signal } = normalizeExecuteArgs(onUpdateArg, ctxArg, signalArg);
      if (signal?.aborted) return cancelledToolResult();

      const params = parseLspToolInput(rawParams);

      const manager = getOrCreateManager(ctx.cwd);
      const severity: SeverityFilter = "severity" in params ? (params.severity ?? "all") : "all";

      try {
        let formatted: { details: LspResultDetails; text: string };

        switch (params.operation) {
          case "diagnostics": {
            const result = await abortable(manager.touchFileAndWait(params.filePath!, diagnosticsWaitMsForFile(params.filePath!)), signal);
            const diagnostics = filterDiagnosticsBySeverity(result.diagnostics, severity);
            const text = (result as { unsupported?: boolean; error?: string; receivedResponse: boolean }).unsupported
              ? `Unsupported: ${(result as { error?: string }).error || "No LSP for this file."}`
              : !result.receivedResponse
                ? "Timeout: LSP server did not respond. Try again."
                : diagnostics.length
                  ? diagnostics.map(formatDiagnostic).join("\n")
                  : "No diagnostics.";
            formatted = {
              text,
              details: {
                operation: params.operation,
                filePath: params.filePath,
                resultCount: diagnostics.length,
                fileCount: diagnostics.length > 0 ? 1 : 0,
              },
            };
            break;
          }
          case "workspaceDiagnostics": {
            const waitMs = Math.max(...params.filePaths!.map(diagnosticsWaitMsForFile));
            const result = await abortable(manager.getDiagnosticsForFiles(params.filePaths!, waitMs), signal);
            formatted = {
              text: (() => {
                const lines: string[] = [];
                let diagnosticsCount = 0;
                let filesWithIssues = 0;
                for (const item of result.items) {
                  const display = path.isAbsolute(item.file) ? path.relative(ctx.cwd, item.file) : item.file;
                  if (item.status !== "ok") {
                    lines.push(`${display}: ${item.error || item.status}`);
                    continue;
                  }
                  const diagnostics = filterDiagnosticsBySeverity(item.diagnostics, severity);
                  if (!diagnostics.length) continue;
                  filesWithIssues += 1;
                  diagnosticsCount += diagnostics.length;
                  lines.push(`${display}:`);
                  for (const diagnostic of diagnostics) lines.push(`  ${formatDiagnostic(diagnostic)}`);
                }
                const summary = `Analyzed ${result.items.length} file(s), found ${diagnosticsCount} diagnostics in ${filesWithIssues} file(s).`;
                return lines.length ? `${summary}\n\n${lines.join("\n")}` : `${summary}\n\nNo diagnostics.`;
              })(),
              details: {
                operation: params.operation,
                resultCount: result.items.reduce((total, item) => total + filterDiagnosticsBySeverity(item.diagnostics, severity).length, 0),
                fileCount: result.items.filter(item => filterDiagnosticsBySeverity(item.diagnostics, severity).length > 0).length,
              },
            };
            break;
          }
          default: {
            if (!(await abortable(manager.supportsOperation(params.filePath!, params.operation), signal))) {
              return buildResult(`Operation ${params.operation} is not supported by the active LSP server for ${params.filePath}.`, {
                operation: params.operation,
                filePath: params.filePath,
                resultCount: 0,
                fileCount: 0,
              });
            }

            await abortable(ensureOpenFile(manager, params.filePath!, ctx.cwd), signal);

            let result: unknown;
            switch (params.operation) {
              case "goToDefinition":
                result = await abortable(manager.getDefinition(params.filePath!, params.line!, params.character!), signal);
                break;
              case "findReferences":
                result = await abortable(manager.getReferences(params.filePath!, params.line!, params.character!), signal);
                break;
              case "hover":
                result = await abortable(manager.getHover(params.filePath!, params.line!, params.character!), signal);
                break;
              case "documentHighlight":
                result = await abortable(manager.getDocumentHighlights(params.filePath!, params.line!, params.character!), signal);
                break;
              case "documentSymbol":
                result = await abortable(manager.getDocumentSymbols(params.filePath!), signal);
                break;
              case "workspaceSymbol":
                result = await abortable(manager.getWorkspaceSymbols(params.filePath!), signal);
                break;
              case "goToImplementation":
                result = await abortable(manager.getImplementation(params.filePath!, params.line!, params.character!), signal);
                break;
              case "typeDefinition":
                result = await abortable(manager.getTypeDefinition(params.filePath!, params.line!, params.character!), signal);
                break;
              case "prepareCallHierarchy":
                result = await abortable(manager.prepareCallHierarchy(params.filePath!, params.line!, params.character!), signal);
                break;
              case "incomingCalls": {
                const items = await abortable(manager.prepareCallHierarchy(params.filePath!, params.line!, params.character!), signal);
                result = items.length ? await abortable(manager.getIncomingCalls(items[0]!), signal) : [];
                break;
              }
              case "outgoingCalls": {
                const items = await abortable(manager.prepareCallHierarchy(params.filePath!, params.line!, params.character!), signal);
                result = items.length ? await abortable(manager.getOutgoingCalls(items[0]!), signal) : [];
                break;
              }
              case "signatureHelp":
                result = await abortable(manager.getSignatureHelp(params.filePath!, params.line!, params.character!), signal);
                break;
              case "rename":
                result = await abortable(manager.rename(params.filePath!, params.line!, params.character!, params.newName!), signal);
                break;
              case "prepareRename":
                result = await abortable(manager.prepareRename(params.filePath!, params.line!, params.character!), signal);
                break;
              case "foldingRange":
                result = await abortable(manager.getFoldingRanges(params.filePath!), signal);
                break;
              case "codeAction":
                result = await abortable(manager.getCodeActions(params.filePath!, params.line!, params.character!, params.endLine, params.endCharacter), signal);
                break;
            }

            formatted = formatOperationResult(params.operation, result, params.filePath, ctx.cwd);
            break;
          }
        }

        return buildResult(formatted.text, formatted.details);
      } catch (error) {
        if (signal?.aborted || isAbortedError(error)) return cancelledToolResult();
        const message = error instanceof Error ? error.message : String(error);
        return buildResult(`Error performing ${params.operation}: ${message}`, {
          operation: params.operation,
          filePath: "filePath" in params ? params.filePath : undefined,
        });
      }
    },

    renderCall(args: unknown, theme: any) {
      const params = args as LspParamsType;
      let text = theme.fg("toolTitle", theme.bold("lsp ")) + theme.fg("accent", params.operation || "...");

      if ("filePath" in params && params.filePath) {
        const symbol = "line" in params && "character" in params && params.line !== undefined && params.character !== undefined
          ? getSymbolAtPosition(params.filePath, params.line - 1, params.character - 1)
          : null;
        if (symbol) text += " " + theme.fg("dim", `${symbol}`);
        text += " " + theme.fg("muted", params.filePath);
      } else if ("filePaths" in params && params.filePaths?.length) {
        text += " " + theme.fg("muted", `${params.filePaths.length} file(s)`);
      }

      if ("line" in params && "character" in params && params.line !== undefined && params.character !== undefined) {
        text += theme.fg("warning", `:${params.line}:${params.character}`);
      }
      if ("severity" in params && params.severity && params.severity !== "all") {
        text += " " + theme.fg("dim", `[${params.severity}]`);
      }

      return new Text(text, 0, 0);
    },

    renderResult(result: any, options: any, theme: any) {
      if (options.isPartial) return new Text("", 0, 0);

      const details = (result.details ?? {}) as LspResultDetails;
      if (!options.expanded) {
        const summary = buildOperationSummary(details);
        if (summary) {
          return new Text(theme.fg("toolOutput", summary), 0, 0);
        }
      }

      const textContent = (result.content?.find((item: { type?: string; text?: string }) => item.type === "text") as { text?: string } | undefined)?.text || "";
      const lines = textContent.split("\n");
      const maxLines = options.expanded ? lines.length : PREVIEW_LINES;
      const display = lines.slice(0, maxLines);
      const remaining = lines.length - display.length;

      let out = display.map(line => theme.fg("toolOutput", line)).join("\n");
      if (remaining > 0) out += theme.fg("dim", `\n... (${remaining} more lines)`);
      return new Text(out, 0, 0);
    },
  });
}
