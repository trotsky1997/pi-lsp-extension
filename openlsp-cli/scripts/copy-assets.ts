import * as fs from "node:fs/promises";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const dist = path.join(root, "dist");

for (const name of ["tree-sitter-queries", "tree-sitter-wasm"]) {
	const source = path.join(root, name);
	const target = path.join(dist, name);
	await fs.rm(target, { recursive: true, force: true });
	await fs.cp(source, target, { recursive: true });
}
