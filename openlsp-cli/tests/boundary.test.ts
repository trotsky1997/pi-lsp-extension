import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(testDir, "..", "src");
const parentImportPattern =
	/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["'](\.\.\/\.\.\/[^"']+)["']|import\(\s*["'](\.\.\/\.\.\/[^"']+)["']\s*\)/g;

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry: Dirent) => {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) return await collectTypeScriptFiles(fullPath);
			return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
		}),
	);
	return files.flat();
}

test("production source does not import parent TypeScript modules", async () => {
	const violations: string[] = [];
	for (const filePath of await collectTypeScriptFiles(sourceRoot)) {
		const source = await fs.readFile(filePath, "utf-8");
		for (const match of source.matchAll(parentImportPattern)) {
			violations.push(
				`${path.relative(sourceRoot, filePath).replaceAll("\\", "/")}: ${match[1] ?? match[2]}`,
			);
		}
	}

	expect(violations).toEqual([]);
});
