import * as path from "node:path";
import { BUILTIN_PROVIDER_MANIFESTS } from "./providers/builtins.ts";
import {
	providerManifestSchema,
	type AdapterManifest,
	type OpenLspConfig,
	type ProviderKind,
	type ProviderManifest,
	type ProviderRuntime,
	type ProviderSource,
} from "./schemas.ts";

export interface RegisteredProvider {
	manifest: ProviderManifest;
	source: ProviderSource;
	sourceLabel: string;
	handler?: string;
}

export interface ProviderCapability {
	id: string;
	kind: ProviderKind;
	runtime: ProviderRuntime;
	extensions: string[];
	fileNames?: string[];
	rootMarkers?: string[];
	source: ProviderSource;
	capabilities: string[];
	handler?: string;
	parser?: string;
	resolver?: string;
}

export interface ProviderSelection {
	providerId: string;
	source: ProviderSource;
	manifest: ProviderManifest;
	customAdapter?: AdapterManifest;
}

const DEFAULT_CAPABILITIES: Record<ProviderKind, string[]> = {
	lsp: ["lsp"],
	formatter: ["format"],
	analyzer: ["analyze"],
	transport: ["transport"],
};

const SOURCE_PRIORITY: Record<ProviderSource, number> = {
	"code-backed": 0,
	"built-in": 1,
	"adapter-compat": 2,
	workspace: 3,
};
const SUPPORTED_ANALYZER_PARSERS = new Set(["plain", "json", "eslint-json"]);

function normalizeManifest(input: ProviderManifest): ProviderManifest {
	return {
		...input,
		extensions: [...(input.extensions ?? [])],
		fileNames: [...(input.fileNames ?? [])],
		capabilities:
			input.capabilities.length > 0
				? [...input.capabilities]
				: [...DEFAULT_CAPABILITIES[input.kind]],
		runtime: input.runtime ?? "bun",
	};
}

function validationLabel(input: unknown): string {
	if (input && typeof input === "object" && "id" in input) {
		return String((input as { id?: unknown }).id ?? "<unknown>");
	}
	return "<unknown>";
}

export function validateProviderManifest(
	input: unknown,
	sourceLabel = "provider",
): ProviderManifest {
	const parsed = providerManifestSchema.safeParse(input);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new Error(
			`Invalid provider ${validationLabel(input)} from ${sourceLabel}: ${issue?.path.join(".") || "<root>"} ${issue?.message || "is invalid"}`,
		);
	}
	if (
		(parsed.data as ProviderManifest).parser &&
		!SUPPORTED_ANALYZER_PARSERS.has((parsed.data as ProviderManifest).parser!)
	) {
		throw new Error(
			`Invalid provider ${validationLabel(input)} from ${sourceLabel}: parser unsupported parser ${(parsed.data as ProviderManifest).parser}`,
		);
	}
	return normalizeManifest(parsed.data as ProviderManifest);
}

function adapterToProvider(adapter: AdapterManifest): ProviderManifest {
	return normalizeManifest({
		id: adapter.id,
		kind: adapter.kind,
		runtime: adapter.runtime,
		command: adapter.command,
		args: adapter.args,
		env: adapter.env,
		extensions: [...(adapter.extensions ?? [])],
		fileNames: [...(adapter.fileNames ?? [])],
		rootMarkers: adapter.rootMarkers,
		capabilities:
			adapter.capabilities.length > 0
				? [...adapter.capabilities]
				: [...DEFAULT_CAPABILITIES[adapter.kind]],
		config: adapter.config,
	});
}

function providerKey(provider: RegisteredProvider): string {
	return `${provider.manifest.kind}:${provider.manifest.id}`;
}

function providerMatchesFile(provider: RegisteredProvider, filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase();
	const baseName = path.basename(filePath);
	const { extensions, fileNames } = provider.manifest;
	if (extensions.length === 0 && fileNames.length === 0) return true;
	return extensions.includes(ext) || fileNames.includes(baseName);
}

export class ProviderRegistry {
	private readonly providers: RegisteredProvider[];

	constructor(config: OpenLspConfig = {}) {
		this.providers = this.mergeProviders([
			...BUILTIN_PROVIDER_MANIFESTS.map((manifest) => ({
				manifest: validateProviderManifest(manifest, "built-in"),
				source: "built-in" as const,
				sourceLabel: "built-in",
				handler: manifest.handler,
			})),
			...(config.adapters ?? []).map((adapter) => ({
				manifest: validateProviderManifest(
					adapterToProvider(adapter),
					"adapter-compat",
				),
				source: "adapter-compat" as const,
				sourceLabel: "adapter-compat",
			})),
			...(config.providers ?? []).map((provider) => ({
				manifest: validateProviderManifest(provider, "workspace"),
				source: "workspace" as const,
				sourceLabel: "workspace",
			})),
		]);
	}

	private mergeProviders(providers: RegisteredProvider[]): RegisteredProvider[] {
		const merged = new Map<string, RegisteredProvider>();
		for (const provider of providers) {
			const key = providerKey(provider);
			const existing = merged.get(key);
			if (
				!existing ||
				SOURCE_PRIORITY[provider.source] >= SOURCE_PRIORITY[existing.source]
			) {
				merged.set(key, provider);
			}
		}
		return [...merged.values()];
	}

	listProviders(): RegisteredProvider[] {
		return [...this.providers];
	}

	listCapabilities(): ProviderCapability[] {
		return this.providers.map(({ manifest, source, handler }) => ({
			id: manifest.id,
			kind: manifest.kind,
			runtime: manifest.runtime,
			extensions: [...manifest.extensions],
			fileNames: manifest.fileNames.length > 0 ? [...manifest.fileNames] : undefined,
			rootMarkers: manifest.rootMarkers ? [...manifest.rootMarkers] : undefined,
			source,
			capabilities: [...manifest.capabilities],
			handler: handler ?? manifest.handler,
			parser: manifest.parser,
			resolver: manifest.resolver,
		}));
	}

	findProvider(kind: ProviderKind, id: string): RegisteredProvider | undefined {
		return this.providers.find(
			(provider) => provider.manifest.kind === kind && provider.manifest.id === id,
		);
	}

	getProvidersForFile(kind: ProviderKind, filePath: string): RegisteredProvider[] {
		return this.providers.filter(
			(provider) =>
				provider.manifest.kind === kind && providerMatchesFile(provider, filePath),
		);
	}

	selectProvider(
		kind: ProviderKind,
		filePath: string,
		requestedId?: string,
		availableIds?: string[],
	): ProviderSelection | null {
		const available = new Set(availableIds ?? []);
		const eligible = this.getProvidersForFile(kind, filePath).filter((provider) =>
			availableIds ? available.has(provider.manifest.id) || provider.source !== "code-backed" : true,
		);

		if (requestedId) {
			const requested = eligible.find(
				(provider) => provider.manifest.id === requestedId,
			);
			if (!requested) {
				throw new Error(`Requested ${kind} provider is unavailable: ${requestedId}`);
			}
			return this.toSelection(requested);
		}

		const first = eligible.find(
			(provider) => !availableIds || available.has(provider.manifest.id),
		) ?? eligible[0];
		return first ? this.toSelection(first) : null;
	}

	selectProviders(
		kind: ProviderKind,
		filePath: string,
		requestedIds: string[] = [],
		availableIds?: string[],
	): ProviderSelection[] {
		if (requestedIds.length === 0) {
			return this.getProvidersForFile(kind, filePath)
				.filter((provider) =>
					availableIds ? availableIds.includes(provider.manifest.id) : true,
				)
				.map((provider) => this.toSelection(provider));
		}
		return requestedIds.map((id) => {
			const selection = this.selectProvider(kind, filePath, id, availableIds);
			if (!selection) {
				throw new Error(`Requested ${kind} provider is unavailable: ${id}`);
			}
			return selection;
		});
	}

	private toSelection(provider: RegisteredProvider): ProviderSelection {
		return {
			providerId: provider.manifest.id,
			source: provider.source,
			manifest: provider.manifest,
		};
	}
}
