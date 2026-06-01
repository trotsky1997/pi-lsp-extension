#!/usr/bin/env bun

import { CommandService, envelopeToText } from "./command-service.ts";
import {
	renderHookOutput,
	runOpenLspHook,
	type HookCheck,
	type HookOutputFormat,
} from "./hook-service.ts";
import { commandRequestSchema, PROTOCOL_VERSION } from "./schemas.ts";
import { BunRuntimeService } from "./runtime.ts";

type ParsedArgs = {
	command: string;
	flags: Record<string, string | boolean>;
};

function parseArgv(argv: string[]): ParsedArgs {
	const [command = "help", ...rest] = argv;
	const flags: Record<string, string | boolean> = {};

	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (!token) continue;
		if (!token.startsWith("--")) continue;

		const key = token.slice(2);
		const next = rest[index + 1];
		if (!next || next.startsWith("--")) {
			flags[key] = true;
			continue;
		}
		flags[key] = next;
		index += 1;
	}

	return { command, flags };
}

function asNumber(value: string | boolean | undefined): number | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function asString(value: string | boolean | undefined): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asHookCheck(value: string | boolean | undefined): HookCheck | undefined {
	return value === "diagnostics" || value === "analyze" || value === "both"
		? value
		: undefined;
}

function asHookOutputFormat(
	value: string | boolean | undefined,
	json: string | boolean | undefined,
): HookOutputFormat | undefined {
	if (json) return "json";
	return value === "claude" || value === "codex" || value === "text" || value === "json"
		? value
		: undefined;
}

function parseCommon(flags: Record<string, string | boolean>) {
	return {
		cwd: asString(flags.cwd),
		workspaceRoot: asString(flags["workspace-root"]),
		configPath: asString(flags.config),
		output: flags.json ? "json" : undefined,
		sessionId: asString(flags.session),
		timeoutMs: asNumber(flags.timeout),
	};
}

function buildCommandRequest(parsed: ParsedArgs) {
	const common = parseCommon(parsed.flags);

	switch (parsed.command) {
		case "lsp":
			return commandRequestSchema.parse({
				command: "lsp",
				operation: asString(parsed.flags.operation),
				filePath: asString(parsed.flags.file),
				filePaths: asString(parsed.flags.files)?.split(",").filter(Boolean),
				line: asNumber(parsed.flags.line),
				character: asNumber(parsed.flags.character),
				endLine: asNumber(parsed.flags["end-line"]),
				endCharacter: asNumber(parsed.flags["end-character"]),
				newName: asString(parsed.flags["new-name"]),
				severity: asString(parsed.flags.severity),
				...common,
			});
		case "format":
			return commandRequestSchema.parse({
				command: "format",
				filePath: asString(parsed.flags.file),
				...common,
			});
		case "analyze":
			return commandRequestSchema.parse({
				command: "analyze",
				filePath: asString(parsed.flags.file),
				...common,
			});
		case "config":
			return commandRequestSchema.parse({ command: "config", ...common });
		case "capabilities":
			return commandRequestSchema.parse({ command: "capabilities", ...common });
		case "session-close":
			return commandRequestSchema.parse({
				command: "session.close",
				...common,
				sessionId: asString(parsed.flags.session),
			});
		default:
			return null;
	}
}

function usage(): string {
	return [
		"openlsp-cli",
		"",
		"Commands:",
		"  lsp --operation <name> [--file <path>] [--line <n>] [--character <n>] [--json]",
		"  format --file <path> [--json]",
		"  analyze --file <path> [--json]",
		"  config [--json]",
		"  capabilities [--json]",
		"  hook [--event <name>] [--check diagnostics|analyze|both] [--format claude|codex|text|json]",
		"  serve [--host <host>] [--port <port>] [--config <path>]",
		"  session-close --session <id> [--json]",
		"",
		"Global flags:",
		"  --cwd <path>",
		"  --workspace-root <path>",
		"  --config <path>",
		"  --timeout <ms>",
		"  --json",
	].join("\n");
}

async function readStdinJson(): Promise<unknown> {
	const input = await new Response(Bun.stdin.stream()).text();
	if (!input.trim()) return {};
	return JSON.parse(input);
}

async function runHook(flags: Record<string, string | boolean>): Promise<void> {
	const outputFormat = asHookOutputFormat(flags.format, flags.json) ?? "claude";
	const input = await readStdinJson();
	const result = await runOpenLspHook(input, {
		eventName: asString(flags.event),
		cwd: asString(flags.cwd),
		configPath: asString(flags.config),
		timeoutMs: asNumber(flags.timeout),
		maxFiles: asNumber(flags["max-files"]),
		check: asHookCheck(flags.check),
		outputFormat,
	});
	if (
		!result.hasFindings &&
		(outputFormat === "claude" || outputFormat === "codex")
	) {
		return;
	}
	console.log(renderHookOutput(result, result.eventName, outputFormat));
}

async function serve(flags: Record<string, string | boolean>): Promise<void> {
	const runtime = new BunRuntimeService();
	runtime.assertAvailable();
	const service = new CommandService();
	const host = asString(flags.host) ?? "127.0.0.1";
	const port = asNumber(flags.port) ?? 4317;

	const server = runtime.serve({
		hostname: host,
		port,
		async fetch(request: Request) {
			const url = new URL(request.url);
			if (request.method === "GET" && url.pathname === "/health") {
				return new Response(
					JSON.stringify({ protocolVersion: PROTOCOL_VERSION, status: "ok" }),
					{ headers: { "content-type": "application/json" } },
				);
			}

			if (request.method === "POST" && url.pathname === "/command") {
				try {
					const body = await request.json();
					const commandRequest = commandRequestSchema.parse(body);
					const envelope = await service.execute(commandRequest, "remote");
					return new Response(JSON.stringify(envelope), {
						headers: { "content-type": "application/json" },
						status: envelope.status === "ok" ? 200 : 400,
					});
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					return new Response(
						JSON.stringify({
							protocolVersion: PROTOCOL_VERSION,
							status: "error",
							runtime: "bun",
							mode: "remote",
							command: "serve",
							workspace: {
								cwd: process.cwd(),
								root: process.cwd(),
								configSources: ["defaults"],
							},
							metadata: { durationMs: 0, warnings: [] },
							error: { code: "invalid_request", message },
						}),
						{
							headers: { "content-type": "application/json" },
							status: 400,
						},
					);
				}
			}

			return new Response("Not Found", { status: 404 });
		},
	});

	console.log(`openlsp-cli serve listening on http://${host}:${server.port}`);
}

async function main(): Promise<void> {
	const parsed = parseArgv(Bun.argv.slice(2));
	if (parsed.command === "help" || parsed.command === "--help") {
		console.log(usage());
		return;
	}

	if (parsed.command === "serve") {
		await serve(parsed.flags);
		return;
	}

	if (parsed.command === "hook") {
		await runHook(parsed.flags);
		return;
	}

	const request = buildCommandRequest(parsed);
	if (!request) {
		console.error(usage());
		process.exit(1);
	}

	const service = new CommandService();
	const envelope = await service.execute(request, "local");

	if (request.output === "json") {
		console.log(JSON.stringify(envelope));
	} else if (envelope.status === "error") {
		console.error(envelopeToText(envelope));
	} else {
		console.log(envelopeToText(envelope));
	}

	if (envelope.status === "error") {
		process.exit(1);
	}
}

await main();
