import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CommandService } from "../src/command-service.ts";
import {
	BunRuntimeCompatibilityError,
	BunRuntimeService,
} from "../src/runtime.ts";

const tempDirs: string[] = [];

async function withTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openlsp-cli-command-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			await fs.rm(dir, { recursive: true, force: true });
		}
	}
	delete process.env.OPENLSP_CONFIG_JSON;
});

test("CommandService surfaces missing requested formatter adapters as structured errors", async () => {
	const dir = await withTempDir();
	await fs.writeFile(path.join(dir, "sample.ts"), "export const value = 1;\n");
	process.env.OPENLSP_CONFIG_JSON = JSON.stringify({
		commands: {
			format: { formatter: "missing-formatter" },
		},
	});

	const service = new CommandService();
	const result = await service.execute({
		command: "format",
		cwd: dir,
		filePath: "sample.ts",
	});

	expect(result.status).toBe("error");
	if (result.status === "error") {
		expect(result.error.message).toContain("missing-formatter");
	}
});

test("CommandService reports built-in and custom capabilities", async () => {
	const dir = await withTempDir();
	process.env.OPENLSP_CONFIG_JSON = JSON.stringify({
		adapters: [
			{
				id: "custom-markdown-analyzer",
				kind: "analyzer",
				runtime: "bun",
				command: "echo",
				args: ["ok"],
				extensions: [".md"],
			},
		],
	});

	const service = new CommandService();
	const result = await service.execute({
		command: "capabilities",
		cwd: dir,
	});

	expect(result.status).toBe("ok");
	if (result.status === "ok") {
		const capabilities = (
			result.data as { capabilities: Array<{ id: string; source?: string }> }
		).capabilities;
		expect(
			capabilities.some((entry) => entry.id === "custom-markdown-analyzer"),
		).toBe(true);
		expect(capabilities.some((entry) => entry.id === "typescript")).toBe(true);
		expect(
			capabilities.some(
				(entry) => entry.id === "taplo" && entry.source === "built-in",
			),
		).toBe(true);
	}
});

test("CommandService reports workspace provider capabilities", async () => {
	const dir = await withTempDir();
	process.env.OPENLSP_CONFIG_JSON = JSON.stringify({
		providers: [
			{
				id: "workspace-transport",
				kind: "transport",
				runtime: "bun",
				command: "openlsp-transport",
				extensions: [],
				capabilities: ["transport"],
			},
		],
	});

	const service = new CommandService();
	const result = await service.execute({
		command: "capabilities",
		cwd: dir,
	});

	expect(result.status).toBe("ok");
	if (result.status === "ok") {
		const capabilities = (
			result.data as { capabilities: Array<{ id: string; source?: string }> }
		).capabilities;
		expect(
			capabilities.some(
				(entry) =>
					entry.id === "workspace-transport" && entry.source === "workspace",
			),
		).toBe(true);
	}
});

test("BunRuntimeService fails fast when Bun runtime services are unavailable", () => {
	class MissingBunRuntimeService extends BunRuntimeService {
		protected override bun(): any {
			return undefined;
		}
	}

	const runtime = new MissingBunRuntimeService();
	expect(() => runtime.assertAvailable()).toThrow(BunRuntimeCompatibilityError);
});
