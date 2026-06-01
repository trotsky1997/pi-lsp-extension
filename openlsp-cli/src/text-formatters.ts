import * as path from "node:path";
import { uriToPath } from "./core/lsp-core.ts";

export function formatSignature(help: any): string {
	if (!help?.signatures?.length) return "No signature help available.";
	const signature =
		help.signatures[help.activeSignature ?? 0] ?? help.signatures[0];
	let text = signature.label ?? "Signature";
	if (signature.documentation) {
		text += `\n${typeof signature.documentation === "string" ? signature.documentation : (signature.documentation?.value ?? "")}`;
	}
	if (signature.parameters?.length) {
		const parameters = signature.parameters
			.map((parameter: { label: string | [number, number] }) =>
				typeof parameter.label === "string"
					? parameter.label
					: Array.isArray(parameter.label)
						? parameter.label.join("-")
						: "",
			)
			.filter(Boolean);
		if (parameters.length) text += `\nParameters: ${parameters.join(", ")}`;
	}
	return text;
}

export function formatWorkspaceEdit(edit: any, cwd: string): string {
	const lines: string[] = [];

	if (edit.documentChanges?.length) {
		for (const change of edit.documentChanges as Array<{
			textDocument?: { uri?: string };
			edits?: Array<{
				newText: string;
				range: { start: { line: number; character: number } };
			}>;
		}>) {
			if (!change.textDocument?.uri) continue;
			const filePath = uriToPath(change.textDocument.uri);
			const display = path.isAbsolute(filePath)
				? path.relative(cwd, filePath)
				: filePath;
			lines.push(`${display}:`);
			for (const item of change.edits ?? []) {
				lines.push(
					`  [${item.range.start.line + 1}:${item.range.start.character + 1}] -> ${JSON.stringify(item.newText)}`,
				);
			}
		}
	}

	if (edit.changes) {
		for (const [uri, edits] of Object.entries(
			edit.changes as Record<
				string,
				Array<{
					newText: string;
					range: { start: { line: number; character: number } };
				}>
			>,
		)) {
			const filePath = uriToPath(uri);
			const display = path.isAbsolute(filePath)
				? path.relative(cwd, filePath)
				: filePath;
			lines.push(`${display}:`);
			for (const item of edits) {
				lines.push(
					`  [${item.range.start.line + 1}:${item.range.start.character + 1}] -> ${JSON.stringify(item.newText)}`,
				);
			}
		}
	}

	return lines.length ? lines.join("\n") : "No edits.";
}

export function formatCodeActions(actions: any[]): string {
	if (!actions.length) return "No code actions available.";
	return actions
		.map((action, index) => {
			const title =
				"title" in action && action.title ? action.title : "Untitled action";
			const kind = "kind" in action && action.kind ? ` (${action.kind})` : "";
			const preferred =
				"isPreferred" in action && action.isPreferred ? " *" : "";
			return `${index + 1}. ${title}${kind}${preferred}`;
		})
		.join("\n");
}
