import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ConfigService } from "../src/config.ts";

const tempDirs: string[] = [];

async function withTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openlsp-cli-config-"));
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

test("ConfigService resolves extends and inline env overrides", async () => {
	const dir = await withTempDir();
	const sharedConfigPath = path.join(dir, "shared.json");
	const rootConfigPath = path.join(dir, "openlsp.config.json");

	await fs.writeFile(
		sharedConfigPath,
		JSON.stringify({
			formatter: {
				enabled: true,
				formatters: {
					prettier: { command: "prettier" },
				},
			},
		}),
	);

	await fs.writeFile(
		rootConfigPath,
		JSON.stringify({
			extends: "./shared.json",
			output: { defaultFormat: "json" },
			commands: {
				format: { formatter: "prettier" },
			},
		}),
	);

	process.env.OPENLSP_CONFIG_JSON = JSON.stringify({
		commands: {
			analyze: { analyzers: ["ruff-check"] },
		},
	});

	const service = new ConfigService();
	const resolved = await service.resolve({ cwd: dir });

	expect(resolved.config.output?.defaultFormat).toBe("json");
	expect(resolved.config.commands?.format?.formatter).toBe("prettier");
	expect(resolved.config.commands?.analyze?.analyzers).toEqual(["ruff-check"]);
	expect(resolved.sources).toContain(sharedConfigPath);
	expect(resolved.sources).toContain(rootConfigPath);
	expect(resolved.sources).toContain("env:OPENLSP_CONFIG_JSON");
});

test("ConfigService ignores Pi settings during native resolution", async () => {
	const dir = await withTempDir();
	await fs.mkdir(path.join(dir, ".pi"), { recursive: true });
	await fs.writeFile(
		path.join(dir, ".pi", "settings.json"),
		JSON.stringify({
			lsp: {
				enabled: false,
				python: { provider: "basedpyright" },
			},
			formatter: { enabled: false },
			analyzer: { enabled: false },
		}),
	);

	const service = new ConfigService();
	const resolved = await service.resolve({ cwd: dir });

	expect(resolved.sources).toEqual(["defaults"]);
	expect(resolved.config.lsp?.enabled).toBe(true);
	expect(resolved.config.lsp?.pythonProvider).toBe("pyright");
	expect(resolved.config.formatter?.enabled).toBe(true);
	expect(resolved.config.analyzer?.enabled).toBe(true);
});
