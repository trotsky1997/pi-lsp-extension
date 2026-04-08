import { relative } from "node:path";
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  DocumentHighlight,
  DocumentSymbol,
  FoldingRange,
  Hover,
  Location,
  LocationLink,
  MarkedString,
  MarkupContent,
  SymbolInformation,
  SymbolKind,
} from "vscode-languageserver-protocol";

function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

function formatUri(uri: string | undefined, cwd?: string): string {
  if (!uri) return "<unknown location>";

  let filePath = uri.replace(/^file:\/\//, "");
  if (/^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }

  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    // Ignore malformed URI sequences and keep the original path-like string.
  }

  if (cwd) {
    const relativePath = relative(cwd, filePath).replaceAll("\\", "/");
    if (
      relativePath.length < filePath.length
      && !relativePath.startsWith("../../")
    ) {
      return relativePath;
    }
  }

  return filePath.replaceAll("\\", "/");
}

function formatLocation(location: Location, cwd?: string): string {
  const filePath = formatUri(location.uri, cwd);
  const line = location.range.start.line + 1;
  const character = location.range.start.character + 1;
  return `${filePath}:${line}:${character}`;
}

export function isLocationLink(item: Location | LocationLink): item is LocationLink {
  return "targetUri" in item;
}

export function toLocation(item: Location | LocationLink): Location {
  if (isLocationLink(item)) {
    return {
      uri: item.targetUri,
      range: item.targetSelectionRange ?? item.targetRange,
    };
  }
  return item;
}

export function formatGoToDefinitionResult(
  result: Location | Location[] | LocationLink | LocationLink[] | null | undefined,
  cwd?: string,
): string {
  if (!result) {
    return "No definition found.";
  }

  const rawItems = Array.isArray(result) ? result : [result];
  const locations = rawItems.map(toLocation).filter(location => Boolean(location?.uri));

  if (locations.length === 0) {
    return "No definition found.";
  }

  if (locations.length === 1) {
    return `Defined in ${formatLocation(locations[0]!, cwd)}`;
  }

  return [
    `Found ${locations.length} definitions:`,
    ...locations.map(location => `  ${formatLocation(location, cwd)}`),
  ].join("\n");
}

export function formatFindReferencesResult(
  result: Location[] | null | undefined,
  cwd?: string,
): string {
  const locations = (result ?? []).filter(location => Boolean(location?.uri));
  if (locations.length === 0) {
    return "No references found.";
  }

  const byFile = new Map<string, Location[]>();
  for (const location of locations) {
    const filePath = formatUri(location.uri, cwd);
    const existing = byFile.get(filePath);
    if (existing) {
      existing.push(location);
    } else {
      byFile.set(filePath, [location]);
    }
  }

  const lines: string[] = [
    `Found ${locations.length} references across ${byFile.size} ${plural(byFile.size, "file")}:`,
  ];

  for (const [filePath, fileLocations] of byFile) {
    lines.push(`\n${filePath}:`);
    for (const location of fileLocations) {
      lines.push(
        `  Line ${location.range.start.line + 1}:${location.range.start.character + 1}`,
      );
    }
  }

  return lines.join("\n");
}

function extractMarkupText(contents: MarkupContent | MarkedString | MarkedString[]): string {
  if (Array.isArray(contents)) {
    return contents
      .map(item => (typeof item === "string" ? item : item.value))
      .join("\n\n");
  }

  if (typeof contents === "string") {
    return contents;
  }

  return contents.value;
}

export function formatHoverResult(result: Hover | null | undefined): string {
  if (!result) {
    return "No hover information available.";
  }

  const content = extractMarkupText(result.contents);
  if (!result.range) {
    return content || "No hover information available.";
  }

  return `Hover info at ${result.range.start.line + 1}:${result.range.start.character + 1}:\n\n${content}`;
}

export function formatDocumentHighlightResult(
  result: DocumentHighlight[] | null | undefined,
): string {
  const highlights = result ?? [];
  if (highlights.length === 0) {
    return "No document highlights found.";
  }

  const kindName = (kind?: number): string => {
    switch (kind) {
      case 2: return "read";
      case 3: return "write";
      default: return "text";
    }
  };

  return [
    `Found ${highlights.length} document highlights:`,
    ...highlights.map(highlight => `  ${highlight.range.start.line + 1}:${highlight.range.start.character + 1} (${kindName(highlight.kind)})`),
  ].join("\n");
}

function symbolKindToString(kind: SymbolKind): string {
  const kinds: Record<number, string> = {
    1: "File",
    2: "Module",
    3: "Namespace",
    4: "Package",
    5: "Class",
    6: "Method",
    7: "Property",
    8: "Field",
    9: "Constructor",
    10: "Enum",
    11: "Interface",
    12: "Function",
    13: "Variable",
    14: "Constant",
    15: "String",
    16: "Number",
    17: "Boolean",
    18: "Array",
    19: "Object",
    20: "Key",
    21: "Null",
    22: "EnumMember",
    23: "Struct",
    24: "Event",
    25: "Operator",
    26: "TypeParameter",
  };

  return kinds[kind] ?? "Unknown";
}

function formatDocumentSymbolNode(symbol: DocumentSymbol, indent = 0): string[] {
  const prefix = "  ".repeat(indent);
  const line = symbol.range.start.line + 1;
  const kind = symbolKindToString(symbol.kind);
  const detail = symbol.detail ? ` ${symbol.detail}` : "";
  const lines = [`${prefix}${symbol.name} (${kind})${detail} - Line ${line}`];

  for (const child of symbol.children ?? []) {
    lines.push(...formatDocumentSymbolNode(child, indent + 1));
  }

  return lines;
}

export function formatDocumentSymbolResult(
  result: DocumentSymbol[] | SymbolInformation[] | null | undefined,
  cwd?: string,
): string {
  if (!result || result.length === 0) {
    return "No symbols found in document.";
  }

  const first = result[0];
  if (first && "location" in first) {
    return formatWorkspaceSymbolResult(result as SymbolInformation[], cwd);
  }

  return [
    "Document symbols:",
    ...(result as DocumentSymbol[]).flatMap(symbol => formatDocumentSymbolNode(symbol)),
  ].join("\n");
}

export function formatWorkspaceSymbolResult(
  result: SymbolInformation[] | null | undefined,
  cwd?: string,
): string {
  const symbols = (result ?? []).filter(symbol => Boolean(symbol?.location?.uri));
  if (symbols.length === 0) {
    return "No symbols found in workspace.";
  }

  const byFile = new Map<string, SymbolInformation[]>();
  for (const symbol of symbols) {
    const filePath = formatUri(symbol.location.uri, cwd);
    const existing = byFile.get(filePath);
    if (existing) {
      existing.push(symbol);
    } else {
      byFile.set(filePath, [symbol]);
    }
  }

  const lines: string[] = [
    `Found ${symbols.length} ${plural(symbols.length, "symbol")} in workspace:`,
  ];

  for (const [filePath, fileSymbols] of byFile) {
    lines.push(`\n${filePath}:`);
    for (const symbol of fileSymbols) {
      const kind = symbolKindToString(symbol.kind);
      const line = symbol.location.range.start.line + 1;
      const container = symbol.containerName ? ` in ${symbol.containerName}` : "";
      lines.push(`  ${symbol.name} (${kind}) - Line ${line}${container}`);
    }
  }

  return lines.join("\n");
}

function formatCallHierarchyItem(item: CallHierarchyItem, cwd?: string): string {
  const filePath = formatUri(item.uri, cwd);
  const line = item.range.start.line + 1;
  const kind = symbolKindToString(item.kind);
  const detail = item.detail ? ` [${item.detail}]` : "";
  return `${item.name} (${kind}) - ${filePath}:${line}${detail}`;
}

export function formatPrepareCallHierarchyResult(
  result: CallHierarchyItem[] | null | undefined,
  cwd?: string,
): string {
  const items = result ?? [];
  if (items.length === 0) {
    return "No call hierarchy item found at this position.";
  }

  if (items.length === 1) {
    return `Call hierarchy item: ${formatCallHierarchyItem(items[0]!, cwd)}`;
  }

  return [
    `Found ${items.length} call hierarchy items:`,
    ...items.map(item => `  ${formatCallHierarchyItem(item, cwd)}`),
  ].join("\n");
}

export function formatIncomingCallsResult(
  result: CallHierarchyIncomingCall[] | null | undefined,
  cwd?: string,
): string {
  const calls = (result ?? []).filter(call => Boolean(call?.from));
  if (calls.length === 0) {
    return "No incoming calls found (nothing calls this function).";
  }

  const byFile = new Map<string, CallHierarchyIncomingCall[]>();
  for (const call of calls) {
    const filePath = formatUri(call.from.uri, cwd);
    const existing = byFile.get(filePath);
    if (existing) {
      existing.push(call);
    } else {
      byFile.set(filePath, [call]);
    }
  }

  const lines: string[] = [
    `Found ${calls.length} incoming ${plural(calls.length, "call")}:`,
  ];

  for (const [filePath, fileCalls] of byFile) {
    lines.push(`\n${filePath}:`);
    for (const call of fileCalls) {
      const line = call.from.range.start.line + 1;
      const kind = symbolKindToString(call.from.kind);
      const ranges = (call.fromRanges ?? [])
        .map((range: { start: { line: number; character: number } }) => `${range.start.line + 1}:${range.start.character + 1}`)
        .join(", ");
      const callSites = ranges ? ` [calls at: ${ranges}]` : "";
      lines.push(`  ${call.from.name} (${kind}) - Line ${line}${callSites}`);
    }
  }

  return lines.join("\n");
}

export function formatOutgoingCallsResult(
  result: CallHierarchyOutgoingCall[] | null | undefined,
  cwd?: string,
): string {
  const calls = (result ?? []).filter(call => Boolean(call?.to));
  if (calls.length === 0) {
    return "No outgoing calls found (this function calls nothing).";
  }

  const byFile = new Map<string, CallHierarchyOutgoingCall[]>();
  for (const call of calls) {
    const filePath = formatUri(call.to.uri, cwd);
    const existing = byFile.get(filePath);
    if (existing) {
      existing.push(call);
    } else {
      byFile.set(filePath, [call]);
    }
  }

  const lines: string[] = [
    `Found ${calls.length} outgoing ${plural(calls.length, "call")}:`,
  ];

  for (const [filePath, fileCalls] of byFile) {
    lines.push(`\n${filePath}:`);
    for (const call of fileCalls) {
      const line = call.to.range.start.line + 1;
      const kind = symbolKindToString(call.to.kind);
      const ranges = (call.fromRanges ?? [])
        .map((range: { start: { line: number; character: number } }) => `${range.start.line + 1}:${range.start.character + 1}`)
        .join(", ");
      const callSites = ranges ? ` [called from: ${ranges}]` : "";
      lines.push(`  ${call.to.name} (${kind}) - Line ${line}${callSites}`);
    }
  }

  return lines.join("\n");
}

export function formatFoldingRangeResult(result: FoldingRange[] | null | undefined): string {
  const ranges = result ?? [];
  if (ranges.length === 0) {
    return "No folding ranges found.";
  }

  return [
    `Found ${ranges.length} folding ranges:`,
    ...ranges.map(range => {
      const endCharacter = range.endCharacter !== undefined ? `:${range.endCharacter + 1}` : "";
      const kind = range.kind ? ` (${range.kind})` : "";
      return `  ${range.startLine + 1}-${range.endLine + 1}${endCharacter}${kind}`;
    }),
  ].join("\n");
}
