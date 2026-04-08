import * as fs from "node:fs";
import * as path from "node:path";

const MAX_READ_BYTES = 64 * 1024;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function getSymbolAtPosition(
  filePath: string,
  line: number,
  character: number,
): string | null {
  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);
    const fd = fs.openSync(absolutePath, "r");

    try {
      const buffer = Buffer.allocUnsafe(MAX_READ_BYTES);
      const bytesRead = fs.readSync(fd, buffer, 0, MAX_READ_BYTES, 0);
      const content = buffer.toString("utf-8", 0, bytesRead);
      const lines = content.split("\n");

      if (line < 0 || line >= lines.length) return null;
      if (bytesRead === MAX_READ_BYTES && line === lines.length - 1) return null;

      const lineContent = lines[line];
      if (!lineContent || character < 0 || character >= lineContent.length) {
        return null;
      }

      const symbolPattern = /[\w$'!]+|[+\-*/%&|^~<>=]+/g;
      let match: RegExpExecArray | null;
      while ((match = symbolPattern.exec(lineContent)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (character >= start && character < end) {
          return truncate(match[0], 30);
        }
      }

      return null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
