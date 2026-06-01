import * as path from "node:path";

export interface BunSpawnResult {
	code: number;
	stdout: string;
	stderr: string;
}

export class BunRuntimeCompatibilityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BunRuntimeCompatibilityError";
	}
}

export class BunRuntimeService {
	protected bun(): any {
		return (globalThis as { Bun?: unknown }).Bun;
	}

	assertAvailable(): void {
		if (!this.bun()) {
			throw new BunRuntimeCompatibilityError(
				"openlsp-cli requires Bun runtime services but Bun is not available.",
			);
		}
	}

	now(): number {
		return performance.now();
	}

	resolvePath(targetPath: string, cwd = process.cwd()): string {
		return path.isAbsolute(targetPath)
			? targetPath
			: path.resolve(cwd, targetPath);
	}

	async exists(targetPath: string): Promise<boolean> {
		this.assertAvailable();
		return (await this.bun().file(targetPath).exists()) === true;
	}

	async readText(targetPath: string): Promise<string> {
		this.assertAvailable();
		return await this.bun().file(targetPath).text();
	}

	async writeText(targetPath: string, content: string): Promise<void> {
		this.assertAvailable();
		await this.bun().write(targetPath, content);
	}

	async spawn(
		command: string,
		args: string[],
		options: {
			cwd?: string;
			env?: Record<string, string | undefined>;
			stdin?: string;
			timeoutMs?: number;
		} = {},
	): Promise<BunSpawnResult> {
		this.assertAvailable();

		const proc = this.bun().spawn({
			cmd: [command, ...args],
			cwd: options.cwd,
			env: options.env,
			stdin: options.stdin === undefined ? "ignore" : "pipe",
			stdout: "pipe",
			stderr: "pipe",
			timeout: options.timeoutMs,
		});

		if (
			typeof options.stdin === "string" &&
			proc.stdin &&
			"write" in proc.stdin
		) {
			proc.stdin.write(options.stdin);
			proc.stdin.flush?.();
			proc.stdin.end?.();
		}

		const [stdout, stderr, code] = await Promise.all([
			proc.stdout?.text() ?? Promise.resolve(""),
			proc.stderr?.text() ?? Promise.resolve(""),
			proc.exited,
		]);

		return { code, stdout, stderr };
	}

	serve(options: any): any {
		this.assertAvailable();
		return this.bun().serve(options);
	}
}
