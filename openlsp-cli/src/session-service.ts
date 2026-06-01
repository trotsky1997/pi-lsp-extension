import { LSPManager } from "./core/lsp-core.ts";
import {
	setResolvedLspSettingsOverride,
	type ResolvedLSPSettings,
} from "./core/lsp-settings.ts";
import { toLegacyResolvedLspSettings } from "./legacy-settings.ts";
import type { OpenLspConfig } from "./schemas.ts";

export interface SessionContext {
	id: string;
	key: string;
	workspaceRoot: string;
	resolvedSettings: ResolvedLSPSettings;
	manager: LSPManager;
	createdAt: number;
	lastUsedAt: number;
}

export class SessionService {
	private readonly sessions = new Map<string, SessionContext>();
	private readonly sessionIdsByKey = new Map<string, string>();
	private sequence = 0;

	private buildSessionKey(
		workspaceRoot: string,
		config: OpenLspConfig,
	): string {
		const serialized = JSON.stringify(config);
		const bun = (globalThis as { Bun?: { hash?: (value: string) => number } })
			.Bun;
		if (bun?.hash) {
			return `${workspaceRoot}:${bun.hash(serialized)}`;
		}
		return `${workspaceRoot}:${serialized}`;
	}

	private nextSessionId(): string {
		this.sequence += 1;
		return `session-${this.sequence}`;
	}

	private resolveSettings(
		workspaceRoot: string,
		config: OpenLspConfig,
	): ResolvedLSPSettings {
		return toLegacyResolvedLspSettings(workspaceRoot, config);
	}

	private applyOverride(
		workspaceRoot: string,
		settings: ResolvedLSPSettings,
	): void {
		setResolvedLspSettingsOverride(workspaceRoot, settings);
	}

	ensureSession(
		workspaceRoot: string,
		config: OpenLspConfig,
		requestedSessionId?: string,
	): { session: SessionContext; reused: boolean } {
		if (requestedSessionId) {
			const existing = this.sessions.get(requestedSessionId);
			if (!existing) {
				throw new Error(`Unknown session: ${requestedSessionId}`);
			}
			existing.lastUsedAt = Date.now();
			this.applyOverride(existing.workspaceRoot, existing.resolvedSettings);
			return { session: existing, reused: true };
		}

		const key = this.buildSessionKey(workspaceRoot, config);
		const existingId = this.sessionIdsByKey.get(key);
		if (existingId) {
			const existing = this.sessions.get(existingId);
			if (existing) {
				existing.lastUsedAt = Date.now();
				this.applyOverride(existing.workspaceRoot, existing.resolvedSettings);
				return { session: existing, reused: true };
			}
		}

		const resolvedSettings = this.resolveSettings(workspaceRoot, config);
		this.applyOverride(workspaceRoot, resolvedSettings);
		const session: SessionContext = {
			id: this.nextSessionId(),
			key,
			workspaceRoot,
			resolvedSettings,
			manager: new LSPManager(workspaceRoot),
			createdAt: Date.now(),
			lastUsedAt: Date.now(),
		};
		this.sessions.set(session.id, session);
		this.sessionIdsByKey.set(key, session.id);
		return { session, reused: false };
	}

	async closeSession(sessionId: string): Promise<boolean> {
		const session = this.sessions.get(sessionId);
		if (!session) return false;

		await session.manager.shutdown();
		this.sessions.delete(sessionId);
		this.sessionIdsByKey.delete(session.key);

		const replacement = [...this.sessions.values()].find(
			(candidate) => candidate.workspaceRoot === session.workspaceRoot,
		);
		if (replacement) {
			setResolvedLspSettingsOverride(
				replacement.workspaceRoot,
				replacement.resolvedSettings,
			);
		} else {
			setResolvedLspSettingsOverride(session.workspaceRoot, undefined);
		}

		return true;
	}
}
