/**
 * Inlined dependency shims for the DAP port — Node.js runtime.
 *
 * Replaces oh-my-pi's internal utilities (@oh-my-pi/pi-utils, ../jsonrpc,
 * ../exec, ../tools, ../config, ../discovery, ../lsp/config) AND the Bun
 * runtime globals (Bun.spawn, Bun.connect, Bun.listen, Bun.sleep, Bun.which,
 * Bun.Glob, Bun.env) with minimal Node.js implementations.
 *
 * pi is a compiled Bun binary, but its extension loader (jiti with
 * tryNative:false + virtualModules) does NOT expose the `Bun` global to
 * extension modules — only Node's `process`, `child_process`, `net`, `fs`,
 * etc. are available. So every Bun.* call in the DAP engine routes through
 * wrappers defined here.
 *
 * Source attribution: these helpers are ported from
 * https://github.com/can1357/oh-my-pi (MIT, Can Boluk / Mario Zechner).
 */

import * as cp from "node:child_process";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { MessageFramer } from "./message-framing.js";

// ── logger ──────────────────────────────────────────────────────────────────
export const logger = {
	debug(..._args: unknown[]): void {
		// Uncomment to trace adapter traffic:
		// console.error("[dap:debug]", ...args);
	},
	warn(...args: unknown[]): void {
		console.error("[dap:warn]", ...args);
	},
	error(...args: unknown[]): void {
		console.error("[dap:error]", ...args);
	},
	info(...args: unknown[]): void {
		console.error("[dap:info]", ...args);
	},
};

// ── error helpers ────────────────────────────────────────────────────────────
export function isEnoent(error: unknown): boolean {
	if (error !== null && typeof error === "object" && "code" in error) {
		return (error as { code: unknown }).code === "ENOENT";
	}
	if (error instanceof Error) {
		return /ENOENT/i.test(error.message);
	}
	return false;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ── abortable ────────────────────────────────────────────────────────────────
export function untilAborted<T>(
	signal: AbortSignal | undefined | null,
	pr: Promise<T> | (() => Promise<T>),
): Promise<T> {
	if (!signal) return typeof pr === "function" ? pr() : pr;
	if (signal.aborted) {
		throw signal.reason instanceof Error
			? signal.reason
			: new Error(signal.reason ? String(signal.reason) : "Aborted");
	}

	const { promise, resolve, reject } = Promise.withResolvers<T>();
	const onAbort = () => {
		reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
	};
	signal.addEventListener("abort", onAbort, { once: true });

	void (async () => {
		try {
			resolve(await (typeof pr === "function" ? pr() : pr));
		} catch (err) {
			reject(err);
		} finally {
			signal.removeEventListener("abort", onAbort);
		}
	})();

	return promise;
}

// ── ToolAbortError ───────────────────────────────────────────────────────────
export class ToolError extends Error {
	constructor(
		message: string,
		readonly context?: Record<string, unknown>,
	) {
		super(message);
		this.name = "ToolError";
	}
}

export class ToolAbortError extends Error {
	constructor(message: string = "Operation aborted", options?: ErrorOptions) {
		super(message, options);
		this.name = "ToolAbortError";
	}
}

// ── NON_INTERACTIVE_ENV ──────────────────────────────────────────────────────
export const NON_INTERACTIVE_ENV: Readonly<Record<string, string>> = {
	PAGER: "cat",
	GIT_PAGER: "cat",
	MANPAGER: "cat",
	SYSTEMD_PAGER: "cat",
	BAT_PAGER: "cat",
	GH_PAGER: "cat",
	GLAB_PAGER: "cat",
	PSQL_PAGER: "cat",
	MYSQL_PAGER: "cat",
	AWS_PAGER: "",
	HOMEBREW_PAGER: "cat",
	LESS: "FRX",
	TERM: "dumb",
	NO_COLOR: "1",
	PYTHONUNBUFFERED: "1",
	GIT_EDITOR: "true",
	VISUAL: "true",
	EDITOR: "true",
	GIT_TERMINAL_PROMPT: "0",
	SSH_ASKPASS: "/usr/bin/false",
	CI: "1",
	AGENT: "1",
	npm_config_yes: "true",
	npm_config_update_notifier: "false",
	npm_config_fund: "false",
	npm_config_audit: "false",
	npm_config_progress: "false",
	PNPM_DISABLE_SELF_UPDATE_CHECK: "true",
	PNPM_UPDATE_NOTIFIER: "false",
	YARN_ENABLE_TELEMETRY: "0",
	YARN_ENABLE_PROGRESS_BARS: "0",
	CARGO_TERM_PROGRESS_WHEN: "never",
	DEBIAN_FRONTEND: "noninteractive",
	PIP_NO_INPUT: "1",
	PIP_DISABLE_PIP_VERSION_CHECK: "1",
	TF_INPUT: "0",
	TF_IN_AUTOMATION: "1",
	GH_PROMPT_DISABLED: "1",
	COMPOSER_NO_INTERACTION: "1",
	CLOUDSDK_CORE_DISABLE_PROMPTS: "1",
	PYDEVD_DISABLE_FILE_VALIDATION: "1",
};

// ── YAML ───────────────────────────────────────────────────────────────────
// omp uses `import { YAML } from "bun"` but pi's jiti loader can't resolve
// the `bun` module. YAML config files are a convenience; JSON works without it.
export function parseYaml(content: string): unknown {
	try {
		return JSON.parse(content);
	} catch {
		// Minimal YAML: not implemented. If dap.yaml is needed, install js-yaml
		// and call it here. JSON config (dap.json) covers the common case.
		return null;
	}
}

// ── which / resolveCommand ───────────────────────────────────────────────────
export const enum WhichCachePolicy {
	Cached = "cached",
	Fresh = "fresh",
	Bypass = "bypass",
	ReadOnly = "readonly",
}

interface ResolveCommandOptions {
	cache?: WhichCachePolicy;
	PATH?: string;
	localRoots?: readonly string[];
}

function resolveCommandFromLocalRoot(command: string, root: string): string | null {
	const binDirs = [
		path.join(root, "node_modules", ".bin"),
		path.join(root, ".bin"),
		path.join(root, "bin"),
	];
	for (const dir of binDirs) {
		try {
			const candidate = path.join(dir, command);
			if (fs.existsSync(candidate)) return candidate;
		} catch {
			// ignore
		}
	}
	return null;
}

function whichOnPath(command: string): string | null {
	// Node has no built-in `which`. Search $PATH manually.
	const PATH = process.env.PATH ?? "";
	const sep = process.platform === "win32" ? ";" : ":";
	const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".exe;.bat;.cmd").split(";") : [""];
	for (const dir of PATH.split(sep)) {
		if (!dir) continue;
		for (const ext of exts) {
			const candidate = path.join(dir, command + ext);
			try {
				fs.accessSync(candidate, fs.constants.X_OK);
				return candidate;
			} catch {
				// not executable or doesn't exist
			}
		}
	}
	return null;
}

export function resolveCommand(command: string, cwd: string, options?: ResolveCommandOptions): string | null {
	if (options?.localRoots) {
		for (const root of options.localRoots) {
			const resolved = resolveCommandFromLocalRoot(command, root);
			if (resolved) return resolved;
		}
	} else {
		const resolved = resolveCommandFromLocalRoot(command, cwd);
		if (resolved) return resolved;
	}
	// If it's already absolute and exists, return it.
	if (path.isAbsolute(command) && fs.existsSync(command)) return command;
	return whichOnPath(command);
}

// ── glob matching (for root markers with * patterns) ────────────────────────
function minimatch(pattern: string, name: string): boolean {
	// Minimal glob→regex for root marker patterns like "*.cabal", "*.sln".
	// Handles: * (any chars), ? (single char), literal everything else.
	let regex = "^";
	for (const ch of pattern) {
		if (ch === "*") regex += ".*";
		else if (ch === "?") regex += ".";
		else if (".+^$(){}|[]\\".includes(ch)) regex += "\\" + ch;
		else regex += ch;
	}
	regex += "$";
	return new RegExp(regex).test(name);
}

export function hasRootMarkers(cwd: string, markers: string[]): boolean {
	let entries: string[] | null = null;
	for (const marker of markers) {
		if (marker.includes("*")) {
			if (entries === null) {
				try {
					entries = fs.readdirSync(cwd);
				} catch {
					entries = [];
				}
			}
			for (const entry of entries) {
				if (minimatch(marker, entry)) return true;
			}
			continue;
		}
		const filePath = path.join(cwd, marker);
		if (fs.existsSync(filePath)) return true;
	}
	return false;
}

// ── config dir paths ─────────────────────────────────────────────────────────
interface GetConfigDirsOptions {
	user?: boolean;
	project?: boolean;
	cwd?: string;
}

export function getConfigDirPaths(_subpath: string, options: GetConfigDirsOptions = {}): string[] {
	const dirs: string[] = [];
	if (options.project) {
		const start = options.cwd ? path.resolve(options.cwd) : process.cwd();
		let dir = start;
		while (true) {
			const candidate = path.join(dir, ".pi");
			if (fs.existsSync(candidate)) dirs.push(candidate);
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	if (options.user) {
		const home = process.env.HOME || process.env.USERPROFILE || ".";
		dirs.push(path.join(home, ".pi"));
	}
	return dirs;
}

export interface ClaudePluginRoot {
	path: string;
}
export function getPreloadedPluginRoots(): readonly ClaudePluginRoot[] {
	return [];
}

// ── sleep ───────────────────────────────────────────────────────────────────
export function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// ── ptree.spawn (Node child_process-based) ───────────────────────────────────
// omp's ptree.ChildProcess wraps Bun.spawn with eager stderr-tail capture and
// process-tree kill. The DAP engine touches: .stdin, .stdout, .exited
// (Promise<number>), .kill(), .exitCode, .peekStderr(). We reproduce that
// surface on top of node:child_process.
const STDERR_TAIL_MAX = 32 * 1024;

export interface SpawnedProcess {
	stdin: { write: (data: string | Uint8Array) => number | Promise<number>; flush: () => void };
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	readonly pid: number;
	readonly exitCode: number | null;
	readonly exited: Promise<number>;
	peekStderr(): string;
	kill(): boolean;
}

interface ChildSpawnOptions {
	cwd?: string;
	env?: Record<string, string | undefined>;
	stdin?: "pipe" | "ignore";
	detached?: boolean;
}

function spawnChild(cmd: string[], opts?: ChildSpawnOptions): SpawnedProcess {
	const { cwd, env, stdin = "pipe", detached = false } = opts ?? {};

	const cleanEnv: Record<string, string> = { ...process.env } as Record<string, string>;
	if (env) {
		for (const [k, v] of Object.entries(env)) {
			if (v !== undefined) cleanEnv[k] = v;
		}
	}

	const child = cp.spawn(cmd[0], cmd.slice(1), {
		cwd,
		env: cleanEnv,
		stdio: [stdin === "ignore" ? "ignore" : "pipe", "pipe", "pipe"],
		detached,
		windowsHide: true,
		shell: false,
	});

	let stderrTail = "";
	let stderrBuf: Buffer[] = [];
	let stderrTotalLen = 0;

	// Eagerly drain stderr into a truncated tail.
	child.stderr?.on("data", (chunk: Buffer) => {
		stderrBuf.push(chunk);
		stderrTotalLen += chunk.length;
		// Trim front chunks while over cap, keeping a contiguous tail.
		while (stderrBuf.length > 1 && stderrTotalLen - stderrBuf[0].length > STDERR_TAIL_MAX) {
			stderrTotalLen -= stderrBuf[0].length;
			stderrBuf.shift();
		}
	});

	function buildTail(): string {
		const combined = stderrBuf.length > 0 ? Buffer.concat(stderrBuf) : Buffer.alloc(0);
		const slice = combined.length > STDERR_TAIL_MAX ? combined.subarray(combined.length - STDERR_TAIL_MAX) : combined;
		return slice.toString("utf-8");
	}

	// Convert Node streams to Web ReadableStreams for the DAP client.
	const stdoutReadable = new ReadableStream<Uint8Array>({
		start(controller) {
			child.stdout?.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
			child.stdout?.on("end", () => controller.close());
			child.stdout?.on("error", e => controller.error(e));
		},
		cancel(reason) {
			child.stdout?.destroy(reason);
		},
	});

	const stderrReadable = new ReadableStream<Uint8Array>({
		start(controller) {
			child.stderr?.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
			child.stderr?.on("end", () => controller.close());
			child.stderr?.on("error", e => controller.error(e));
		},
		cancel(reason) {
			child.stderr?.destroy(reason);
		},
	});

	const exitedPromise = new Promise<number>((resolve, reject) => {
		child.on("exit", (code, signal) => {
			// Give stderr a tick to flush before resolving, so peekStderr is accurate.
			setImmediate(() => {
				stderrTail = buildTail();
				resolve(code ?? (signal ? -1 : 0));
			});
		});
		child.on("error", err => {
			stderrTail = buildTail();
			reject(err);
		});
	});
	exitedPromise.catch(() => {});

	return {
		pid: child.pid ?? -1,
		stdin: {
			write: (data: string | Uint8Array) => {
				return child.stdin?.write(data) ?? false;
			},
			flush: () => {
				// Node doesn't have a separate flush; writes are buffered.
			},
		},
		stdout: stdoutReadable,
		stderr: stderrReadable,
		get exitCode() {
			return child.exitCode;
		},
		exited: exitedPromise,
		peekStderr: () => stderrTail || buildTail(),
		kill: () => {
			try {
				// Kill the process group if detached, else just the child.
				if (detached && child.pid) {
					try { process.kill(-child.pid); } catch { child.kill(); }
				} else {
					child.kill();
				}
				return true;
			} catch {
				return false;
			}
		},
	};
}

export const ptree = {
	spawn: spawnChild,
};

export const prompt = {
	confirm: async (_message: string): Promise<boolean> => true,
};

// ── TCP socket abstractions (replacing Bun.connect / Bun.listen) ────────────
// The DAP client uses Bun.listen (for socket-client-addr mode) and Bun.connect
// (for TCP and unix socket modes). We provide Node net-based equivalents with
// a Bun-compatible surface: they return a SocketTransport with readable/writeSink.

export interface SocketTransport {
	readable: ReadableStream<Uint8Array>;
	writeSink: DapWriteSink;
	socket: { end(): void };
}

export interface DapWriteSink {
	write(data: string | Uint8Array): number | Promise<number>;
	flush(): number | Promise<number> | undefined;
}

function nodeSocketToTransport(socket: net.Socket): SocketTransport {
	const readable = new ReadableStream<Uint8Array>({
		start(controller) {
			socket.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
			socket.on("end", () => controller.close());
			socket.on("error", e => {
				try { controller.error(e); } catch { /* already closed */ }
			});
		},
		cancel() {
			socket.destroy();
		},
	});
	const writeSink: DapWriteSink = {
		write(data: string | Uint8Array) {
			return socket.write(data);
		},
		flush() {
			// Node doesn't have explicit flush; writes are buffered in the kernel.
			return undefined;
		},
	};
	return { readable, writeSink, socket: { end: () => socket.end() } };
}

/** Connect to a TCP host:port. Returns a SocketTransport + an optional onClose. */
export function connectTcp(
	host: string,
	port: number,
	onClose?: () => void,
): Promise<SocketTransport> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ host, port }, () => {
			resolve(nodeSocketToTransport(socket));
		});
		socket.on("error", err => {
			onClose?.();
			reject(err);
		});
		socket.on("close", () => {
			onClose?.();
		});
	});
}

/** Connect to a unix domain socket. */
export function connectUnix(
	socketPath: string,
	onClose?: () => void,
): Promise<SocketTransport> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(socketPath, () => {
			resolve(nodeSocketToTransport(socket));
		});
		socket.on("error", err => {
			onClose?.();
			reject(err);
		});
		socket.on("close", () => {
			onClose?.();
		});
	});
}

/** Start a TCP listener on a random port, accept one connection, return it. */
export function listenAndAccept(
	onOpen: (transport: SocketTransport) => void,
): { port: number; stop: () => void } {
	const server = net.createServer(socket => {
		onOpen(nodeSocketToTransport(socket));
	});
	server.listen(0, "127.0.0.1");
	const addr = server.address();
	const port = typeof addr === "object" && addr ? addr.port : 0;
	return {
		port,
		stop: () => server.close(),
	};
}

/** Check if a unix domain socket file exists and is a socket. */
export async function isUnixSocketReady(socketPath: string): Promise<boolean> {
	try {
		const stat = await fs.promises.stat(socketPath);
		return stat.isSocket() || stat.isFile(); // on win, it's a file
	} catch (error) {
		if (isEnoent(error)) return false;
		throw error;
	}
}

// Re-export MessageFramer so the DAP client can import it transitively.
export { MessageFramer };
