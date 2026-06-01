import * as path from "node:path";
import { AdapterRegistry, type AdapterCapability } from "./adapter-registry.ts";
import { ConfigService, type ResolvedOpenLspConfig } from "./config.ts";
import type { CommandRequest } from "./schemas.ts";

export interface WorkspaceContext {
	cwd: string;
	root: string;
	resolvedConfig: ResolvedOpenLspConfig;
	capabilities: AdapterCapability[];
}

export class WorkspaceService {
	constructor(
		private readonly configService = new ConfigService(),
		private readonly adapterRegistry = new AdapterRegistry(),
	) {}

	async resolve(request: CommandRequest): Promise<WorkspaceContext> {
		const cwd = path.resolve(request.cwd ?? process.cwd());
		const resolvedConfig = await this.configService.resolve({
			cwd,
			workspaceRoot: request.workspaceRoot,
			configPath: request.configPath,
		});

		return {
			cwd,
			root: resolvedConfig.workspaceRoot,
			capabilities: this.adapterRegistry.listCapabilities(
				resolvedConfig.config,
			),
			resolvedConfig,
		};
	}
}
