import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
	collectPatchCommandPaths,
	hookResultHasFindings,
	renderHookOutput,
	resolveHookFiles,
	runOpenLspHook,
	type HookRunResult,
} from "../src/hook-service.ts";

test("resolveHookFiles extracts existing source files from nested hook input", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openlsp-hook-"));
	try {
		const sourcePath = path.join(dir, "src", "index.ts");
		await fs.mkdir(path.dirname(sourcePath), { recursive: true });
		await fs.writeFile(sourcePath, "export const value = 1;\n");

		const files = resolveHookFiles(
			{
				tool_name: "Write",
				tool_input: {
					file_path: "src/index.ts",
				},
				tool_response: {
					ignored: "README",
				},
			},
			dir,
		);

		expect(files).toEqual([sourcePath]);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

test("renderHookOutput emits Claude additionalContext JSON", () => {
	const result: HookRunResult = {
		files: ["/tmp/index.ts"],
		eventName: "PostToolUse",
		hasFindings: true,
		message: "OpenLSP found issues.",
		checks: [],
	};

	expect(JSON.parse(renderHookOutput(result, "PostToolUse", "claude"))).toEqual({
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: "OpenLSP found issues.",
		},
	});
});

test("renderHookOutput emits Codex additionalContext JSON", () => {
	const result: HookRunResult = {
		files: ["/tmp/index.ts"],
		eventName: "PostToolUse",
		hasFindings: true,
		message: "OpenLSP found issues.",
		checks: [],
	};

	expect(JSON.parse(renderHookOutput(result, "PostToolUse", "codex"))).toEqual({
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: "OpenLSP found issues.",
		},
	});
});

test("runOpenLspHook infers Codex hook event name and preserves explicit override", async () => {
	const inferred = await runOpenLspHook(
		{ hook_event_name: "PostToolUse", tool_input: {} },
		{ check: "diagnostics" },
	);
	const overridden = await runOpenLspHook(
		{ hook_event_name: "PostToolUse", tool_input: {} },
		{ eventName: "UserPromptSubmit", check: "diagnostics" },
	);

	expect(inferred.eventName).toBe("PostToolUse");
	expect(overridden.eventName).toBe("UserPromptSubmit");
});

test("collectPatchCommandPaths extracts Codex apply_patch file headers", () => {
	expect(
		collectPatchCommandPaths(
			[
				"*** Begin Patch",
				"*** Add File: src/new.ts",
				"*** Update File: src/existing.ts",
				"*** Delete File: src/old.ts",
				"*** Move to: src/moved.ts",
				"*** End Patch",
			].join("\n"),
		),
	).toEqual(["src/new.ts", "src/existing.ts", "src/old.ts", "src/moved.ts"]);
});

test("resolveHookFiles extracts Codex apply_patch, MCP, file URI, and duplicates", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openlsp-codex-hook-"));
	try {
		const sourcePath = path.join(dir, "src", "index.ts");
		const mcpPath = path.join(dir, "src", "tool.ts");
		await fs.mkdir(path.dirname(sourcePath), { recursive: true });
		await fs.writeFile(sourcePath, "export const value = 1;\n");
		await fs.writeFile(mcpPath, "export const tool = 1;\n");

		const files = resolveHookFiles(
			{
				hook_event_name: "PostToolUse",
				tool_name: "apply_patch",
				tool_input: {
					command: [
						"*** Begin Patch",
						"*** Update File: src/index.ts",
						"*** Update File: src/index.ts",
						"*** End Patch",
					].join("\n"),
					nested: {
						uri: pathToFileURL(sourcePath).href,
						file_path: "src/tool.ts",
					},
				},
			},
			dir,
		);

		expect(files).toEqual([sourcePath, mcpPath]);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

test("hook finding filter ignores unsupported diagnostics but preserves real findings", () => {
	const unsupported: HookRunResult = {
		files: ["/tmp/README.md"],
		eventName: "PostToolUse",
		hasFindings: false,
		message: "",
		checks: [
			{
				filePath: "/tmp/README.md",
				command: "diagnostics",
				status: "ok",
				text: "Unsupported: No LSP for .md",
			},
		],
	};
	const realFinding: HookRunResult = {
		files: ["/tmp/index.ts"],
		eventName: "PostToolUse",
		hasFindings: false,
		message: "",
		checks: [
			{
				filePath: "/tmp/index.ts",
				command: "diagnostics",
				status: "ok",
				text: "ERROR [1:1] Type mismatch",
			},
		],
	};

	expect(hookResultHasFindings(unsupported)).toBe(false);
	expect(hookResultHasFindings(realFinding)).toBe(true);
});
