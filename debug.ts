/**
 * DAP debug tool for pi — drives a real debugger (lldb-dap, gdb, dlv,
 * debugpy, codelldb, rdbg, …) via the Debug Adapter Protocol.
 *
 * This is a port of oh-my-pi's debug capability (https://github.com/can1357/oh-my-pi,
 * MIT, Can Boluk / Mario Zechner). The DAP engine in ./dap/ is ported near-verbatim;
 * this file is the pi extension surface — it replaces omp's TUI-heavy
 * tools/debug.ts rendering layer with plain text output suitable for any
 * pi renderer (terminal or RPC).
 *
 * Usage: the LLM calls the `debug` tool with an `action` and the relevant
 * parameters. Sessions persist across calls (launch once, then step/inspect).
 *
 * Adapters: configure via ~/.pi/dap.json or .pi/dap.json (see dap/defaults.json
 * for the built-in set). The adapter binary must exist on PATH.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	getDapSessionManager,
	getAvailableAdapters,
	getAdapterConfigs,
	selectAttachAdapter,
	selectLaunchAdapter,
	resolveLaunchOverrides,
	type DapBreakpointRecord,
	type DapCapabilities,
	type DapContinueOutcome,
	type DapDataBreakpointInfoResponse,
	type DapDataBreakpointRecord,
	type DapDisassembledInstruction,
	type DapEvaluateArguments,
	type DapEvaluateResponse,
	type DapFunctionBreakpointRecord,
	type DapInstructionBreakpointRecord,
	type DapModule,
	type DapResolvedAdapter,
	type DapSessionSummary,
	type DapSource,
	type DapStackFrame,
	type DapThread,
	type DapVariable,
	type LaunchProgramKind,
} from "./dap/_engine.js";
import { isEnoent } from "./dap/_deps.js";

// ── schema ─────────────────────────────────────────────────────────────────

const ACTIONS = [
	"launch",
	"attach",
	"set_breakpoint",
	"remove_breakpoint",
	"set_instruction_breakpoint",
	"remove_instruction_breakpoint",
	"data_breakpoint_info",
	"set_data_breakpoint",
	"remove_data_breakpoint",
	"continue",
	"step_over",
	"step_in",
	"step_out",
	"pause",
	"evaluate",
	"stack_trace",
	"threads",
	"scopes",
	"variables",
	"disassemble",
	"read_memory",
	"write_memory",
	"modules",
	"loaded_sources",
	"custom_request",
	"output",
	"terminate",
	"sessions",
] as const;

// Per-request DAP timeout default (seconds). Clamped to [1, 300].
const DEFAULT_TIMEOUT_SEC = 30;
const MAX_TIMEOUT_SEC = 300;

function clampTimeout(timeout: number | undefined): number {
	if (timeout === undefined || timeout <= 0) return DEFAULT_TIMEOUT_SEC;
	return Math.min(Math.max(timeout, 1), MAX_TIMEOUT_SEC);
}

const debugSchema = Type.Object({
	action: StringEnum(ACTIONS),
	program: Type.Optional(Type.String({ description: "Delve accepts Go package directories" })),
	args: Type.Optional(Type.Array(Type.String())),
	adapter: Type.Optional(Type.String({ description: "adapter id (gdb, lldb-dap, debugpy, dlv, rdbg, or dap.json entry)" })),
	cwd: Type.Optional(Type.String()),
	file: Type.Optional(Type.String()),
	line: Type.Optional(Type.Number()),
	function: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	condition: Type.Optional(Type.String({ description: "breakpoint condition" })),
	hit_condition: Type.Optional(Type.String()),
	expression: Type.Optional(Type.String()),
	context: Type.Optional(Type.String({ description: "evaluate context: watch | repl | hover | variables | clipboard" })),
	frame_id: Type.Optional(Type.Number()),
	scope_id: Type.Optional(Type.Number()),
	variable_ref: Type.Optional(Type.Number()),
	pid: Type.Optional(Type.Number({ description: "process id for attach" })),
	port: Type.Optional(Type.Number({ description: "remote attach port" })),
	host: Type.Optional(Type.String()),
	levels: Type.Optional(Type.Number()),
	memory_reference: Type.Optional(Type.String({ description: "address or memory reference" })),
	instruction_reference: Type.Optional(Type.String()),
	instruction_count: Type.Optional(Type.Number()),
	instruction_offset: Type.Optional(Type.Number()),
	count: Type.Optional(Type.Number()),
	data: Type.Optional(Type.String({ description: "base64" })),
	data_id: Type.Optional(Type.String()),
	access_type: Type.Optional(StringEnum(["read", "write", "readWrite"] as const)),
	command: Type.Optional(Type.String({ description: "custom DAP request command" })),
	arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	offset: Type.Optional(Type.Number()),
	resolve_symbols: Type.Optional(Type.Boolean()),
	allow_partial: Type.Optional(Type.Boolean()),
	start_module: Type.Optional(Type.Number()),
	module_count: Type.Optional(Type.Number()),
	timeout: Type.Optional(Type.Number({ description: "seconds" })),
});

type DebugParams = typeof debugSchema extends { static: infer S } ? S : never;

interface DebugDetails {
	action: string;
	success: boolean;
	snapshot?: DapSessionSummary;
	sessions?: DapSessionSummary[];
	stackFrames?: DapStackFrame[];
	threads?: DapThread[];
	variables?: DapVariable[];
	sources?: DapSource[];
	modules?: DapModule[];
	evaluation?: DapEvaluateResponse;
	breakpoints?: DapBreakpointRecord[];
	functionBreakpoints?: DapFunctionBreakpointRecord[];
	instructionBreakpoints?: DapInstructionBreakpointRecord[];
	dataBreakpoints?: DapDataBreakpointRecord[];
	dataBreakpointInfo?: DapDataBreakpointInfoResponse;
	disassembly?: DapDisassembledInstruction[];
	memoryAddress?: string;
	memoryData?: string;
	unreadableBytes?: number;
	bytesWritten?: number;
	customBody?: unknown;
	output?: string;
	adapter?: string;
	state?: DapContinueOutcome["state"];
	timedOut?: boolean;
}

// ── formatting helpers (ported from omp tools/debug.ts) ─────────────────────

function formatLocation(snapshot: DapSessionSummary | undefined): string | null {
	if (!snapshot?.source?.path || snapshot.line === undefined) return null;
	return `${snapshot.source.path}:${snapshot.line}${snapshot.column !== undefined ? `:${snapshot.column}` : ""}`;
}

function formatSessionSnapshot(snapshot: DapSessionSummary): string[] {
	const lines = [
		`Session ${snapshot.id}`,
		`Adapter: ${snapshot.adapter}`,
		`Status: ${snapshot.status}`,
		`CWD: ${snapshot.cwd}`,
	];
	if (snapshot.program) lines.push(`Program: ${snapshot.program}`);
	if (snapshot.stopReason) lines.push(`Stop reason: ${snapshot.stopReason}`);
	if (snapshot.frameName) lines.push(`Frame: ${snapshot.frameName}`);
	if (snapshot.instructionPointerReference) lines.push(`Instruction pointer: ${snapshot.instructionPointerReference}`);
	const location = formatLocation(snapshot);
	if (location) lines.push(`Location: ${location}`);
	if (snapshot.needsConfigurationDone) {
		lines.push("Configuration: pending configurationDone; set breakpoints, then continue.");
	}
	if (snapshot.exitCode !== undefined) lines.push(`Exit code: ${snapshot.exitCode}`);
	return lines;
}

function formatBreakpoints(filePath: string, breakpoints: DapBreakpointRecord[]): string {
	const lines = [`Breakpoints for ${filePath}:`];
	if (breakpoints.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}
	for (const bp of breakpoints) {
		lines.push(`- line ${bp.line}: ${bp.verified ? "verified" : "pending"}${bp.condition ? ` if ${bp.condition}` : ""}${bp.message ? ` (${bp.message})` : ""}`);
	}
	return lines.join("\n");
}

function formatFunctionBreakpoints(breakpoints: DapFunctionBreakpointRecord[]): string {
	const lines = ["Function breakpoints:"];
	if (breakpoints.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}
	for (const bp of breakpoints) {
		lines.push(`- ${bp.name}: ${bp.verified ? "verified" : "pending"}${bp.condition ? ` if ${bp.condition}` : ""}${bp.message ? ` (${bp.message})` : ""}`);
	}
	return lines.join("\n");
}

function formatStackFrames(frames: DapStackFrame[]): string {
	const lines = ["Stack trace:"];
	if (frames.length === 0) {
		lines.push("(empty)");
		return lines.join("\n");
	}
	for (const frame of frames) {
		const location = frame.source?.path
			? `${frame.source.path}:${frame.line}:${frame.column}`
			: `<unknown>:${frame.line}:${frame.column}`;
		lines.push(`- #${frame.id} ${frame.name} @ ${location}`);
	}
	return lines.join("\n");
}

function formatThreads(threads: DapThread[]): string {
	const lines = ["Threads:"];
	if (threads.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}
	for (const thread of threads) {
		lines.push(`- ${thread.id}: ${thread.name}`);
	}
	return lines.join("\n");
}

function formatScopes(scopes: { name: string; variablesReference: number; expensive: boolean; presentationHint?: string }[]): string {
	const lines = ["Scopes:"];
	if (scopes.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}
	for (const scope of scopes) {
		lines.push(`- ${scope.name}: ref=${scope.variablesReference}, expensive=${scope.expensive ? "yes" : "no"}${scope.presentationHint ? `, hint=${scope.presentationHint}` : ""}`);
	}
	return lines.join("\n");
}

function formatVariables(variables: DapVariable[]): string {
	const lines = ["Variables:"];
	if (variables.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}
	for (const v of variables) {
		lines.push(`- ${v.name} = ${v.value}${v.type ? ` (${v.type})` : ""}${v.variablesReference > 0 ? ` [ref=${v.variablesReference}]` : ""}`);
	}
	return lines.join("\n");
}

function formatSourceLabel(source: DapSource | undefined, line?: number, column?: number): string | null {
	if (!source?.path && !source?.name) return null;
	const base = source.path ?? source.name ?? "<unknown>";
	if (line === undefined) return base;
	return `${base}:${line}${column !== undefined ? `:${column}` : ""}`;
}

function formatDisassembly(instructions: DapDisassembledInstruction[]): string {
	const lines = ["Disassembly:"];
	if (instructions.length === 0) {
		lines.push("(empty)");
		return lines.join("\n");
	}
	const addressWidth = Math.max(...instructions.map(i => i.address.length));
	const bytesWidth = Math.max(...instructions.map(i => i.instructionBytes?.length ?? 0), 2);
	for (const inst of instructions) {
		const location = formatSourceLabel(inst.location, inst.line, inst.column);
		const parts = [
			inst.address.padEnd(addressWidth),
			(inst.instructionBytes ?? "").padEnd(bytesWidth),
			inst.instruction,
		];
		if (inst.symbol) parts.push(`<${inst.symbol}>`);
		if (location) parts.push(`[${location}]`);
		lines.push(parts.filter(p => p.length > 0).join("  ").trimEnd());
	}
	return lines.join("\n");
}

function formatMemoryRead(address: string, data: string | undefined, unreadableBytes?: number): string {
	const lines = [`Memory at ${address}:`];
	const buffer = data ? Buffer.from(data, "base64") : Buffer.alloc(0);
	if (buffer.length === 0) {
		lines.push("(no readable bytes)");
	} else {
		for (let offset = 0; offset < buffer.length; offset += 16) {
			const chunk = buffer.subarray(offset, offset + 16);
			const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, "0")).join(" ");
			const ascii = Array.from(chunk).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : ".").join("");
			lines.push(`${(address + offset).padStart(address.length, "0")}  ${hex.padEnd(48)}  ${ascii}`);
		}
	}
	if (unreadableBytes) lines.push(`(${unreadableBytes} unreadable bytes)`);
	return lines.join("\n");
}

function formatTable(headers: string[], rows: string[][]): string {
	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? "").length)));
	const formatRow = (row: string[]) => row.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ");
	return [formatRow(headers), formatRow(widths.map(w => "-".repeat(w))), ...rows.map(formatRow)].join("\n");
}

function formatModules(modules: DapModule[]): string {
	if (modules.length === 0) return "Modules:\n(none)";
	return ["Modules:", formatTable(["ID", "Name", "Path", "Symbols", "Range"],
		modules.map(m => [String(m.id), m.name, m.path ?? "", m.symbolStatus ?? "", m.addressRange ?? ""]))].join("\n");
}

function formatLoadedSources(sources: DapSource[]): string {
	const lines = ["Loaded sources:"];
	if (sources.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}
	for (const s of sources) {
		const label = s.path ?? s.name ?? "<unknown>";
		lines.push(`- ${label}${s.sourceReference !== undefined ? ` [ref=${s.sourceReference}]` : ""}`);
	}
	return lines.join("\n");
}

function formatInstructionBreakpoints(breakpoints: DapInstructionBreakpointRecord[]): string {
	const lines = ["Instruction breakpoints:"];
	if (breakpoints.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}
	for (const bp of breakpoints) {
		const loc = `${bp.instructionReference}${bp.offset !== undefined ? `+${bp.offset}` : ""}`;
		lines.push(`- ${loc}: ${bp.verified ? "verified" : "pending"}${bp.condition ? ` if ${bp.condition}` : ""}${bp.hitCondition ? ` after ${bp.hitCondition}` : ""}${bp.message ? ` (${bp.message})` : ""}`);
	}
	return lines.join("\n");
}

function formatDataBreakpointInfo(info: DapDataBreakpointInfoResponse): string {
	const lines = [`Data breakpoint info: ${info.description}`];
	lines.push(`Data ID: ${info.dataId ?? "(not available)"}`);
	if (info.accessTypes && info.accessTypes.length > 0) lines.push(`Access types: ${info.accessTypes.join(", ")}`);
	if (info.canPersist !== undefined) lines.push(`Persistent: ${info.canPersist ? "yes" : "no"}`);
	return lines.join("\n");
}

function formatDataBreakpoints(breakpoints: DapDataBreakpointRecord[]): string {
	const lines = ["Data breakpoints:"];
	if (breakpoints.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}
	for (const bp of breakpoints) {
		lines.push(`- ${bp.dataId}: ${bp.verified ? "verified" : "pending"}${bp.accessType ? ` (${bp.accessType})` : ""}${bp.condition ? ` if ${bp.condition}` : ""}${bp.hitCondition ? ` after ${bp.hitCondition}` : ""}${bp.message ? ` (${bp.message})` : ""}`);
	}
	return lines.join("\n");
}

function formatCustomResponse(command: string, body: unknown): string {
	let serialized = "";
	try {
		serialized = JSON.stringify(body, null, 2) ?? "null";
	} catch {
		serialized = String(body);
	}
	return `${command} response:\n${serialized}`;
}

function formatSessions(sessions: DapSessionSummary[]): string {
	if (sessions.length === 0) return "No debug sessions.";
	return sessions.map(s => {
		const location = formatLocation(s);
		return [
			`${s.id}: ${s.status}`,
			`  adapter=${s.adapter}`,
			`  cwd=${s.cwd}`,
			...(s.program ? [`  program=${s.program}`] : []),
			...(location ? [`  location=${location}`] : []),
			...(s.stopReason ? [`  reason=${s.stopReason}`] : []),
		].join("\n");
	}).join("\n\n");
}

function formatEvaluation(evaluation: DapEvaluateResponse): string {
	const lines = [`Result: ${evaluation.result}`];
	if (evaluation.type) lines.push(`Type: ${evaluation.type}`);
	if (evaluation.variablesReference > 0) lines.push(`Variables ref: ${evaluation.variablesReference}`);
	return lines.join("\n");
}

function buildOutcomeText(outcome: DapContinueOutcome, timeoutSec: number, verb: string): string {
	const lines = formatSessionSnapshot(outcome.snapshot);
	if (outcome.timedOut) {
		lines.push(`Program is still running after ${timeoutSec}s. Use pause to interrupt and inspect state.`);
		return lines.join("\n");
	}
	if (outcome.state === "stopped") {
		lines.push(`${verb} stopped at ${formatLocation(outcome.snapshot) ?? "unknown location"}.`);
		return lines.join("\n");
	}
	if (outcome.state === "terminated") {
		lines.push(`Program terminated${outcome.snapshot.exitCode !== undefined ? ` with exit code ${outcome.snapshot.exitCode}` : ""}.`);
		return lines.join("\n");
	}
	lines.push("Program is running.");
	return lines.join("\n");
}

// ── launch helpers ──────────────────────────────────────────────────────────

const ADAPTER_UNAVAILABLE_MESSAGES: Readonly<Record<string, string>> = {
	debugpy: "adapter 'debugpy' is not available: python not found in PATH. Install with 'pip install debugpy'.",
	dlv: "adapter 'dlv' is not available: install with 'go install github.com/go-delve/delve/cmd/dlv@latest'",
	rdbg: "adapter 'rdbg' is not available: install with 'gem install debug'",
	"js-debug-adapter": "adapter 'js-debug-adapter' is not available: download from https://github.com/microsoft/vscode-js-debug",
	"lldb-dap": "adapter 'lldb-dap' is not available: install from https://github.com/llvm/llvm-project/tree/main/lldb/tools/lldb-dap",
	gdb: "adapter 'gdb' is not available: install gdb (e.g. 'apt install gdb' or 'brew install gdb')",
	codelldb: "adapter 'codelldb' is not available: install from https://github.com/vadimcn/codelldb",
};

function getConfiguredAdapters(cwd: string): string {
	const adapters = getAvailableAdapters(cwd).map(a => a.name);
	return adapters.length > 0 ? adapters.join(", ") : "none";
}

function formatAdapterUnavailable(adapterName: string, _command: string, cwd: string): string {
	return ADAPTER_UNAVAILABLE_MESSAGES[adapterName] ?? `adapter '${adapterName}' is not available. Installed adapters: ${getConfiguredAdapters(cwd)}`;
}

async function classifyLaunchProgram(program: string): Promise<LaunchProgramKind> {
	try {
		return (await fs.stat(program)).isDirectory() ? "directory" : "file";
	} catch (error) {
		if (isEnoent(error)) return "missing";
		throw error;
	}
}

function validateLaunchProgram(program: string, _cwd: string, programKind: LaunchProgramKind, adapter: DapResolvedAdapter): void {
	if (programKind !== "directory" || adapter.acceptsDirectoryProgram) return;
	if (programKind === "missing") {
		throw new Error(`Program not found: ${program}. Check the path or compile the target first.`);
	}
	throw new Error(`Adapter '${adapter.name}' cannot debug a directory. Provide a compiled binary or source file.`);
}

function requireCapability(capability: keyof DapCapabilities, description: string): DapSessionSummary {
	const snapshot = getDapSessionManager().getActiveSession();
	if (getDapSessionManager().getCapabilities()?.[capability] !== true) {
		throw new Error(`Current adapter does not support ${description}`);
	}
	return snapshot!;
}

function resolveDisassemblyReference(memoryReference: string | undefined): string {
	if (memoryReference) return memoryReference;
	const snapshot = getDapSessionManager().getActiveSession();
	return snapshot?.instructionPointerReference ?? "0";
}

function resolveToCwd(p: string | undefined, cwd: string): string | undefined {
	return p ? path.resolve(cwd, p) : undefined;
}

// ── tool definition ─────────────────────────────────────────────────────────

interface DebugToolState {
	cwd: string;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "debug",
		label: "Debug",
		description:
		"Drive a real debugger (lldb-dap, gdb, dlv, debugpy, codelldb, rdbg) via DAP. Launch/attach, set breakpoints, step, inspect stack/variables/memory, evaluate expressions. Sessions persist across calls.",
	promptSnippet:
		"Attach lldb/gdb/dlv/debugpy and step through a real program: launch, set breakpoints, inspect stack/variables/memory",
	promptGuidelines: [
		"Use the debug tool to drive a real debugger via DAP, not print statements. Sessions are stateful: launch/attach once, then step/inspect across calls. Adapters must be on PATH (lldb-dap for C/Rust, debugpy for Python, dlv for Go).",
	],
	parameters: debugSchema,

	async execute(_toolCallId: string, params: DebugParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) {
		const timeoutSec = clampTimeout(params.timeout);
		const timeoutSignal = AbortSignal.timeout(timeoutSec * 1000);
		const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
		const details: DebugDetails = { action: params.action, success: true };
		const cwd = ctx.cwd;
		const text = (s: string) => ({ content: [{ type: "text" as const, text: s }], details });

		switch (params.action) {
			case "launch": {
				if (!params.program) throw new Error("program is required for launch");
				const commandCwd = resolveToCwd(params.cwd, cwd) ?? cwd;
				const program = path.resolve(commandCwd, params.program);
				const programKind = await classifyLaunchProgram(program);
				const selection = selectLaunchAdapter(program, commandCwd, params.adapter, programKind);
				if (selection.kind === "unavailable") {
					throw new Error(formatAdapterUnavailable(selection.adapterName, selection.command, commandCwd));
				}
				if (selection.kind === "none") {
					throw new Error(`No debugger adapter available for '${params.program}'. Installed adapters: ${getConfiguredAdapters(commandCwd)}`);
				}
				const { adapter } = selection;
				validateLaunchProgram(program, commandCwd, programKind, adapter);
				const extraLaunchArguments = resolveLaunchOverrides(adapter, program, programKind);
				const snapshot = await getDapSessionManager().launch(
					{ adapter, program, args: params.args, cwd: commandCwd, extraLaunchArguments },
					combinedSignal,
					timeoutSec * 1000,
				);
				details.snapshot = snapshot;
				details.adapter = adapter.name;
				return text(formatSessionSnapshot(snapshot).join("\n"));
			}
			case "attach": {
				if (params.pid === undefined && params.port === undefined) throw new Error("attach requires pid or port");
				const commandCwd = resolveToCwd(params.cwd, cwd) ?? cwd;
				const adapter = selectAttachAdapter(commandCwd, params.adapter, params.port);
				if (!adapter) {
					if (params.adapter) throw new Error(formatAdapterUnavailable(params.adapter, "", commandCwd));
					throw new Error(`No debugger adapter available for attach. Installed adapters: ${getConfiguredAdapters(commandCwd)}`);
				}
				const snapshot = await getDapSessionManager().attach(
					{ adapter, cwd: commandCwd, pid: params.pid, port: params.port, host: params.host },
					combinedSignal,
					timeoutSec * 1000,
				);
				details.snapshot = snapshot;
				details.adapter = adapter.name;
				return text(formatSessionSnapshot(snapshot).join("\n"));
			}
			case "set_breakpoint": {
				if (!params.file || params.line === undefined) throw new Error("set_breakpoint requires file and line");
				const file = path.resolve(cwd, params.file);
				const response = await getDapSessionManager().setBreakpoint(file, params.line, params.condition, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.breakpoints = response.breakpoints;
				return text(formatBreakpoints(response.sourcePath, response.breakpoints));
			}
			case "remove_breakpoint": {
				if (params.function) {
					const response = await getDapSessionManager().removeFunctionBreakpoint(params.function, combinedSignal, timeoutSec * 1000);
					details.snapshot = response.snapshot;
					details.functionBreakpoints = response.breakpoints;
					return text(formatFunctionBreakpoints(response.breakpoints));
				}
				if (!params.file || params.line === undefined) throw new Error("remove_breakpoint requires file+line or function");
				const file = path.resolve(cwd, params.file);
				const response = await getDapSessionManager().removeBreakpoint(file, params.line, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.breakpoints = response.breakpoints;
				return text(formatBreakpoints(response.sourcePath, response.breakpoints));
			}
			case "set_instruction_breakpoint": {
				requireCapability("supportsInstructionBreakpoints", "instruction breakpoints");
				if (!params.instruction_reference) throw new Error("instruction_reference is required for set_instruction_breakpoint");
				const response = await getDapSessionManager().setInstructionBreakpoint(params.instruction_reference, params.offset, params.condition, params.hit_condition, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.instructionBreakpoints = response.breakpoints;
				return text(formatInstructionBreakpoints(response.breakpoints));
			}
			case "remove_instruction_breakpoint": {
				requireCapability("supportsInstructionBreakpoints", "instruction breakpoints");
				if (!params.instruction_reference) throw new Error("instruction_reference is required for remove_instruction_breakpoint");
				const response = await getDapSessionManager().removeInstructionBreakpoint(params.instruction_reference, params.offset, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.instructionBreakpoints = response.breakpoints;
				return text(formatInstructionBreakpoints(response.breakpoints));
			}
			case "data_breakpoint_info": {
				requireCapability("supportsDataBreakpoints", "data breakpoints");
				if (!params.name) throw new Error("name is required for data_breakpoint_info");
				const response = await getDapSessionManager().dataBreakpointInfo(params.name, params.variable_ref ?? params.scope_id, params.frame_id, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.dataBreakpointInfo = response.info;
				return text(formatDataBreakpointInfo(response.info));
			}
			case "set_data_breakpoint": {
				requireCapability("supportsDataBreakpoints", "data breakpoints");
				if (!params.data_id) throw new Error("data_id is required for set_data_breakpoint");
				const response = await getDapSessionManager().setDataBreakpoint(params.data_id, params.access_type, params.condition, params.hit_condition, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.dataBreakpoints = response.breakpoints;
				return text(formatDataBreakpoints(response.breakpoints));
			}
			case "remove_data_breakpoint": {
				requireCapability("supportsDataBreakpoints", "data breakpoints");
				if (!params.data_id) throw new Error("data_id is required for remove_data_breakpoint");
				const response = await getDapSessionManager().removeDataBreakpoint(params.data_id, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.dataBreakpoints = response.breakpoints;
				return text(formatDataBreakpoints(response.breakpoints));
			}
			case "continue": {
				const outcome = await getDapSessionManager().continue(combinedSignal, timeoutSec * 1000);
				details.snapshot = outcome.snapshot;
				details.state = outcome.state;
				details.timedOut = outcome.timedOut;
				return text(buildOutcomeText(outcome, timeoutSec, "Continue"));
			}
			case "step_over": {
				const outcome = await getDapSessionManager().stepOver(combinedSignal, timeoutSec * 1000);
				details.snapshot = outcome.snapshot;
				details.state = outcome.state;
				details.timedOut = outcome.timedOut;
				return text(buildOutcomeText(outcome, timeoutSec, "Step over"));
			}
			case "step_in": {
				const outcome = await getDapSessionManager().stepIn(combinedSignal, timeoutSec * 1000);
				details.snapshot = outcome.snapshot;
				details.state = outcome.state;
				details.timedOut = outcome.timedOut;
				return text(buildOutcomeText(outcome, timeoutSec, "Step in"));
			}
			case "step_out": {
				const outcome = await getDapSessionManager().stepOut(combinedSignal, timeoutSec * 1000);
				details.snapshot = outcome.snapshot;
				details.state = outcome.state;
				details.timedOut = outcome.timedOut;
				return text(buildOutcomeText(outcome, timeoutSec, "Step out"));
			}
			case "pause": {
				const snapshot = await getDapSessionManager().pause(combinedSignal, timeoutSec * 1000);
				details.snapshot = snapshot;
				return text([...formatSessionSnapshot(snapshot), "Program paused."].join("\n"));
			}
			case "evaluate": {
				if (!params.expression) throw new Error("expression is required for evaluate");
				const evaluationContext = (params.context as DapEvaluateArguments["context"] | undefined) ?? "repl";
				const response = await getDapSessionManager().evaluate(params.expression, evaluationContext, params.frame_id, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.evaluation = response.evaluation;
				return text(formatEvaluation(response.evaluation));
			}
			case "stack_trace": {
				const response = await getDapSessionManager().stackTrace(params.levels, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.stackFrames = response.stackFrames;
				return text(formatStackFrames(response.stackFrames));
			}
			case "threads": {
				const response = await getDapSessionManager().threads(combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.threads = response.threads;
				return text(formatThreads(response.threads));
			}
			case "scopes": {
				const response = await getDapSessionManager().scopes(params.frame_id, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.variables = response.scopes as unknown as DapVariable[];
				return text(formatScopes(response.scopes));
			}
			case "variables": {
				const variableReference = params.variable_ref ?? params.scope_id;
				if (variableReference === undefined) throw new Error("variables requires variable_ref or scope_id");
				const response = await getDapSessionManager().variables(variableReference, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.variables = response.variables;
				return text(formatVariables(response.variables));
			}
			case "disassemble": {
				requireCapability("supportsDisassembleRequest", "disassembly");
				if (params.instruction_count === undefined) throw new Error("instruction_count is required for disassemble");
				const response = await getDapSessionManager().disassemble(resolveDisassemblyReference(params.memory_reference), params.instruction_count, params.offset, params.instruction_offset, params.resolve_symbols, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.disassembly = response.instructions;
				return text(formatDisassembly(response.instructions));
			}
			case "read_memory": {
				requireCapability("supportsReadMemoryRequest", "memory reads");
				if (!params.memory_reference) throw new Error("memory_reference is required for read_memory");
				if (params.count === undefined) throw new Error("count is required for read_memory");
				const response = await getDapSessionManager().readMemory(params.memory_reference, params.count, params.offset, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.memoryAddress = response.address;
				details.memoryData = response.data;
				details.unreadableBytes = response.unreadableBytes;
				return text(formatMemoryRead(response.address, response.data, response.unreadableBytes));
			}
			case "write_memory": {
				requireCapability("supportsWriteMemoryRequest", "memory writes");
				if (!params.memory_reference) throw new Error("memory_reference is required for write_memory");
				if (!params.data) throw new Error("data is required for write_memory");
				const response = await getDapSessionManager().writeMemory(params.memory_reference, params.data, params.offset, params.allow_partial, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.bytesWritten = response.bytesWritten;
				return text(["Memory write completed.", ...(response.bytesWritten !== undefined ? [`Bytes written: ${response.bytesWritten}`] : []), ...(response.offset !== undefined ? [`Offset: ${response.offset}`] : [])].join("\n"));
			}
			case "modules": {
				requireCapability("supportsModulesRequest", "module introspection");
				const response = await getDapSessionManager().modules(params.start_module, params.module_count, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.modules = response.modules;
				return text(formatModules(response.modules));
			}
			case "loaded_sources": {
				requireCapability("supportsLoadedSourcesRequest", "loaded sources");
				const response = await getDapSessionManager().loadedSources(combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.sources = response.sources;
				return text(formatLoadedSources(response.sources));
			}
			case "custom_request": {
				if (!params.command) throw new Error("command is required for custom_request");
				const response = await getDapSessionManager().customRequest(params.command, params.arguments, combinedSignal, timeoutSec * 1000);
				details.snapshot = response.snapshot;
				details.customBody = response.body;
				return text(formatCustomResponse(params.command, response.body));
			}
			case "output": {
				const response = getDapSessionManager().getOutput();
				details.snapshot = response.snapshot;
				details.output = response.output;
				return text(response.output.length > 0 ? response.output : "(no output captured)");
			}
			case "terminate": {
				const snapshot = await getDapSessionManager().terminate(combinedSignal, timeoutSec * 1000);
				if (!snapshot) return text("No debug session to terminate.");
				details.snapshot = snapshot;
				return text([...formatSessionSnapshot(snapshot), "Debug session terminated."].join("\n"));
			}
			case "sessions": {
				const sessions = getDapSessionManager().listSessions();
				details.sessions = sessions;
				return text(formatSessions(sessions));
			}
			default:
				throw new Error(`Unsupported debug action: ${params.action}`);
		}
	},
	});
	// ponytail: no /debug command, no TUI rendering. The tool's text output is
	// sufficient for terminal and RPC modes. Add a /debug command if interactive
	// session management becomes useful.
}
