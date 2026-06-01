import * as path from "node:path";
import { ProviderRegistry, type ProviderCapability } from "./provider-registry.ts";
import { BunRuntimeService, type BunSpawnResult } from "./runtime.ts";
import type { AdapterManifest, OpenLspConfig, ProviderManifest } from "./schemas.ts";

export type AdapterCapability = ProviderCapability;

export interface ResolvedAdapterSelection {
	adapterId: string;
	source: "built-in" | "custom";
	manifest?: AdapterManifest;
	providerSource?: AdapterCapability["source"];
}

function getCommandPreference(config: OpenLspConfig, commandName: string) {
	return config.commands?.[commandName] ?? {};
}

export class AdapterRegistry {
	constructor(private readonly runtime = new BunRuntimeService()) {}

	listCapabilities(config: OpenLspConfig): AdapterCapability[] {
		return new ProviderRegistry(config).listCapabilities();
	}

	private providerToAdapterManifest(
		manifest: ProviderManifest,
	): AdapterManifest | undefined {
		if (manifest.runtime === "handler") return undefined;
		return {
			id: manifest.id,
			kind: manifest.kind,
			runtime: manifest.runtime,
			command: manifest.command,
			args: manifest.args,
			env: manifest.env,
			extensions: [...manifest.extensions],
			fileNames: [...manifest.fileNames],
			rootMarkers: manifest.rootMarkers,
			capabilities: [...manifest.capabilities],
			config: manifest.config,
		};
	}

	private matchesCustomAdapter(
		manifest: AdapterManifest,
		filePath: string,
	): boolean {
		const ext = path.extname(filePath).toLowerCase();
		const baseName = path.basename(filePath);
		if (
			(manifest.extensions?.length ?? 0) === 0 &&
			(manifest.fileNames?.length ?? 0) === 0
		) {
			return true;
		}
		return (
			(manifest.extensions ?? []).includes(ext) ||
			(manifest.fileNames ?? []).includes(baseName)
		);
	}

	resolveFormatter(
		config: OpenLspConfig,
		filePath: string,
		availableFormatterIds: string[],
	): ResolvedAdapterSelection | null {
		const requestedId = getCommandPreference(config, "format").formatter;
		const selection = new ProviderRegistry(config).selectProvider(
			"formatter",
			filePath,
			requestedId,
			availableFormatterIds,
		);
		if (!selection) return null;

		const manifest = this.providerToAdapterManifest(selection.manifest);
		const isBuiltIn =
			selection.source === "code-backed" || selection.source === "built-in";
		return {
			adapterId: selection.providerId,
			source: isBuiltIn ? "built-in" : "custom",
			manifest: isBuiltIn ? undefined : manifest,
			providerSource: selection.source,
		};
	}

	resolveAnalyzers(
		config: OpenLspConfig,
		filePath: string,
		availableAnalyzerIds: string[],
	): ResolvedAdapterSelection[] {
		const requestedIds = getCommandPreference(config, "analyze").analyzers;
		const selections = new ProviderRegistry(config).selectProviders(
			"analyzer",
			filePath,
			requestedIds ?? [],
			availableAnalyzerIds,
		);

		return selections.map((selection) => {
			const manifest = this.providerToAdapterManifest(selection.manifest);
			const isBuiltIn =
				selection.source === "code-backed" || selection.source === "built-in";
			return {
				adapterId: selection.providerId,
				source: isBuiltIn ? ("built-in" as const) : ("custom" as const),
				manifest: isBuiltIn ? undefined : manifest,
				providerSource: selection.source,
			};
		});
	}

	async runCustomAdapter(
		manifest: AdapterManifest,
		filePath: string,
		workspaceRoot: string,
		timeoutMs?: number,
	): Promise<BunSpawnResult> {
		if (!manifest.command) {
			throw new Error(`Custom adapter ${manifest.id} is missing a command.`);
		}

		const args = (manifest.args ?? []).map((value) =>
			value
				.replaceAll("{file}", filePath)
				.replaceAll("{workspaceRoot}", workspaceRoot),
		);

		return await this.runtime.spawn(manifest.command, args, {
			cwd: workspaceRoot,
			env: manifest.env,
			timeoutMs,
		});
	}
}
