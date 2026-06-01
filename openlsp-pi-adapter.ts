import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_ENTRYPOINT = path.join(__dirname, "openlsp-cli", "src", "cli.ts");

interface OpenLspEnvelope {
	status: "ok" | "error";
	metadata?: Record<string, unknown>;
	data?: { text?: string } & Record<string, unknown>;
	error?: { code?: string; message?: string };
	session?: { id: string; reused: boolean };
}

function translatePiSettingsToOpenLspConfig(
	raw: unknown,
): Record<string, unknown> {
	const data =
		raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
	const analyzerSection =
		data.analyzer && typeof data.analyzer === "object" ? data.analyzer : {};

	return {
		lsp: {
			enabled: data.lsp?.enabled,
			pythonProvider: data.lsp?.python?.provider,
			servers: data.lsp?.servers,
		},
		formatter: {
			enabled: data.formatter?.enabled,
			formatters: data.formatter?.formatters,
		},
		analyzer: {
			enabled: analyzerSection.enabled,
			analyzers: analyzerSection.analyzers ?? analyzerSection.tools,
		},
	};
}

function readPiSettingsAsOpenLspConfig(cwd: string): Record<string, unknown> {
	const settingsPath = path.join(cwd, ".pi", "settings.json");
	if (!fs.existsSync(settingsPath)) return {};
	try {
		const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
		return translatePiSettingsToOpenLspConfig(raw);
	} catch {
		return {};
	}
}

function buildCliArgs(params: Record<string, unknown>, cwd: string): string[] {
	const args = [
		"run",
		CLI_ENTRYPOINT,
		"lsp",
		"--operation",
		String(params.operation),
		"--json",
		"--cwd",
		cwd,
	];
	if (typeof params.filePath === "string") {
		args.push("--file", params.filePath);
	}
	if (Array.isArray(params.filePaths) && params.filePaths.length > 0) {
		args.push("--files", params.filePaths.join(","));
	}
	if (typeof params.line === "number") {
		args.push("--line", String(params.line));
	}
	if (typeof params.character === "number") {
		args.push("--character", String(params.character));
	}
	if (typeof params.endLine === "number") {
		args.push("--end-line", String(params.endLine));
	}
	if (typeof params.endCharacter === "number") {
		args.push("--end-character", String(params.endCharacter));
	}
	if (typeof params.newName === "string") {
		args.push("--new-name", params.newName);
	}
	if (typeof params.severity === "string") {
		args.push("--severity", params.severity);
	}
	return args;
}

export async function tryExecuteOpenLspFromPi(
	params: Record<string, unknown>,
	cwd: string,
): Promise<{ text: string; details: Record<string, unknown> } | null> {
	if (!fs.existsSync(CLI_ENTRYPOINT)) return null;

	const env = {
		...process.env,
		OPENLSP_CONFIG_JSON: JSON.stringify(readPiSettingsAsOpenLspConfig(cwd)),
	};

	const stdout = await new Promise<string | null>((resolve) => {
		let output = "";
		let failed = false;

		try {
			const child = spawn("bun", buildCliArgs(params, cwd), {
				cwd,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});

			child.stdout?.on("data", (chunk: Buffer) => {
				output += chunk.toString("utf-8");
			});
			child.once("error", () => {
				failed = true;
				resolve(null);
			});
			child.once("exit", () => {
				if (!failed) resolve(output.trim() || null);
			});
		} catch {
			resolve(null);
		}
	});

	if (!stdout) return null;

	try {
		const envelope = JSON.parse(stdout) as OpenLspEnvelope;
		if (envelope.status === "error") {
			return {
				text: `${envelope.error?.code || "openlsp_error"}: ${envelope.error?.message || "Unknown openlsp-cli error"}`,
				details: {
					source: "openlsp-cli",
					...envelope.metadata,
				},
			};
		}

		return {
			text: envelope.data?.text || "",
			details: {
				source: "openlsp-cli",
				sessionId: envelope.session?.id,
				sessionReused: envelope.session?.reused,
				...envelope.metadata,
			},
		};
	} catch {
		return null;
	}
}
