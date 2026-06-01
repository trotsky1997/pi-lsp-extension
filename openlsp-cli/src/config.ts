import * as path from "node:path";
import { ZodError } from "zod";
import { BunRuntimeService } from "./runtime.ts";
import { openLspConfigSchema, type OpenLspConfig } from "./schemas.ts";

export interface ResolvedOpenLspConfig {
	config: OpenLspConfig;
	cwd: string;
	workspaceRoot: string;
	sources: string[];
}

const DEFAULT_CONFIG: OpenLspConfig = {
	output: { defaultFormat: "text" },
	lsp: { enabled: true, pythonProvider: "pyright", servers: {} },
	formatter: { enabled: true, formatters: {} },
	analyzer: { enabled: true, analyzers: {} },
	commands: {},
	adapters: [],
	providers: [],
	remote: { enabled: true, host: "127.0.0.1", port: 4317, timeoutMs: 30_000 },
};

interface ResolveConfigOptions {
	cwd?: string;
	workspaceRoot?: string;
	configPath?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: Partial<T>): T {
	if (!isPlainObject(base) || !isPlainObject(override)) {
		return (override as T) ?? base;
	}

	const result: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const previous = result[key];
		if (isPlainObject(previous) && isPlainObject(value)) {
			result[key] = deepMerge(previous, value);
			continue;
		}
		result[key] = value;
	}
	return result as T;
}

export class ConfigService {
	constructor(private readonly runtime = new BunRuntimeService()) {}

	private parseConfig(input: unknown, label: string): OpenLspConfig {
		try {
			return openLspConfigSchema.parse(input);
		} catch (error) {
			if (error instanceof ZodError) {
				const issue = error.issues[0];
				throw new Error(
					`Invalid OpenLSP config in ${label}: ${issue?.path.join(".") || "<root>"} ${issue?.message || "is invalid"}`,
				);
			}
			throw error;
		}
	}

	private async readJsonConfig(
		configPath: string,
		label: string,
	): Promise<OpenLspConfig> {
		const raw = await this.runtime.readText(configPath);
		return this.parseConfig(JSON.parse(raw), label);
	}

	private async loadConfigFileRecursive(
		configPath: string,
		visited = new Set<string>(),
	): Promise<{ config: OpenLspConfig; sources: string[] }> {
		const absolutePath = path.resolve(configPath);
		if (visited.has(absolutePath)) {
			throw new Error(`Config extends cycle detected at ${absolutePath}`);
		}
		visited.add(absolutePath);

		if (!(await this.runtime.exists(absolutePath))) {
			throw new Error(`Config file not found: ${absolutePath}`);
		}

		const parsed = await this.readJsonConfig(absolutePath, absolutePath);
		const baseDir = path.dirname(absolutePath);
		const extendsEntries = parsed.extends
			? Array.isArray(parsed.extends)
				? parsed.extends
				: [parsed.extends]
			: [];

		let merged: OpenLspConfig = {};
		let sources: string[] = [];
		for (const extendEntry of extendsEntries) {
			const extendPath = path.isAbsolute(extendEntry)
				? extendEntry
				: path.resolve(baseDir, extendEntry);
			const loaded = await this.loadConfigFileRecursive(extendPath, visited);
			merged = deepMerge(merged, loaded.config);
			sources = [...sources, ...loaded.sources];
		}

		const configWithoutExtends = { ...parsed };
		delete configWithoutExtends.extends;

		return {
			config: deepMerge(merged, configWithoutExtends),
			sources: [...sources, absolutePath],
		};
	}

	async resolve(
		options: ResolveConfigOptions = {},
	): Promise<ResolvedOpenLspConfig> {
		const cwd = path.resolve(options.cwd ?? process.cwd());
		const workspaceRoot = path.resolve(options.workspaceRoot ?? cwd);

		let merged = DEFAULT_CONFIG;
		let sources = ["defaults"];

		const configPath = options.configPath
			? path.resolve(cwd, options.configPath)
			: path.join(workspaceRoot, "openlsp.config.json");

		if (options.configPath || (await this.runtime.exists(configPath))) {
			const fileConfig = await this.loadConfigFileRecursive(configPath);
			merged = deepMerge(merged, fileConfig.config);
			sources = [...sources, ...fileConfig.sources];
		}

		const inlineConfig = process.env.OPENLSP_CONFIG_JSON;
		if (inlineConfig) {
			merged = deepMerge(
				merged,
				this.parseConfig(JSON.parse(inlineConfig), "OPENLSP_CONFIG_JSON"),
			);
			sources = [...sources, "env:OPENLSP_CONFIG_JSON"];
		}

		const config = this.parseConfig(merged, "resolved config");
		const resolvedWorkspaceRoot = config.workspaceRoot
			? path.resolve(workspaceRoot, config.workspaceRoot)
			: workspaceRoot;

		return {
			config,
			cwd,
			workspaceRoot: resolvedWorkspaceRoot,
			sources,
		};
	}
}
