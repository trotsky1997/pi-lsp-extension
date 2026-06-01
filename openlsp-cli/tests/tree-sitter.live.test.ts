import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const tempDirs: string[] = [];
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openlsp-cli-live-"));
	tempDirs.push(dir);
	return dir;
}

async function runCli(args: string[]) {
	const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
		cwd: packageRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env },
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true });
	}
});

test("live CLI uses AST tree-sitter fallback for TypeScript document symbols", async () => {
	const dir = await withTempDir();
	await fs.writeFile(
		path.join(dir, "openlsp.config.json"),
		JSON.stringify({ lsp: { enabled: false } }),
	);
	await fs.writeFile(
		path.join(dir, "live.ts"),
		[
			"export interface LiveWidget {",
			"  name: string;",
			"}",
			"",
			"export function createLiveWidget(): LiveWidget {",
			"  return { name: 'ok' };",
			"}",
			"",
		].join("\n"),
	);

	const result = await runCli([
		"lsp",
		"--operation",
		"documentSymbol",
		"--file",
		"live.ts",
		"--cwd",
		dir,
		"--json",
	]);

	expect(result.exitCode).toBe(0);
	expect(result.stderr).toBe("");
	const envelope = JSON.parse(result.stdout) as {
		status: string;
		metadata: { backend?: string };
		data: { result: Array<{ name: string }> };
	};
	expect(envelope.status).toBe("ok");
	expect(envelope.metadata.backend).toBe("tree-sitter");
	expect(envelope.data.result.map((symbol) => symbol.name)).toContain(
		"LiveWidget",
	);
});
