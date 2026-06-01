import { z } from "zod";

export const PROTOCOL_VERSION = "1.0.0";

export const severitySchema = z.enum([
	"all",
	"error",
	"warning",
	"info",
	"hint",
]);
export const outputFormatSchema = z.enum(["text", "json"]);
export const adapterKindSchema = z.enum([
	"lsp",
	"formatter",
	"analyzer",
	"transport",
]);
export const adapterRuntimeSchema = z.enum(["bun", "legacy"]);
export const pythonProviderSchema = z.enum(["pyright", "basedpyright", "ty"]);
export const lspOperationSchema = z.enum([
	"goToDefinition",
	"findReferences",
	"hover",
	"documentHighlight",
	"documentSymbol",
	"workspaceSymbol",
	"goToImplementation",
	"typeDefinition",
	"prepareCallHierarchy",
	"incomingCalls",
	"outgoingCalls",
	"diagnostics",
	"workspaceDiagnostics",
	"signatureHelp",
	"rename",
	"prepareRename",
	"foldingRange",
	"codeAction",
]);

const positiveInt = z.number().int().positive();
const stringRecordSchema = z.record(z.string(), z.string());
const unknownRecordSchema = z.record(z.string(), z.unknown());
const stringArraySchema = z.array(z.string().min(1));
type RefinementContext = {
	addIssue: (issue: {
		code: "custom";
		path?: Array<string | number>;
		message: string;
	}) => void;
};
type AdapterManifestRefinementInput = {
	kind: string;
	command?: string;
};
type ProviderManifestRefinementInput = {
	id: string;
	kind: string;
	runtime?: string;
	command?: string;
	handler?: string;
	parser?: string;
	resolver?: string;
};
type LspCommandRefinementInput = {
	operation: string;
	filePath?: string;
	filePaths?: string[];
	line?: number;
	character?: number;
	endLine?: number;
	endCharacter?: number;
	newName?: string;
};

export const adapterOverrideSchema = z
	.object({
		disabled: z.boolean().optional(),
		command: z.string().min(1).optional(),
		args: stringArraySchema.optional(),
		env: stringRecordSchema.optional(),
		environment: stringRecordSchema.optional(),
		extensions: stringArraySchema.optional(),
		fileNames: stringArraySchema.optional(),
		rootMarkers: stringArraySchema.optional(),
		runtime: adapterRuntimeSchema.optional(),
	})
	.passthrough();

export const adapterManifestSchema = z
	.object({
		id: z.string().min(1),
		kind: adapterKindSchema,
		runtime: adapterRuntimeSchema.default("bun"),
		command: z.string().min(1).optional(),
		args: stringArraySchema.optional(),
		env: stringRecordSchema.optional(),
		extensions: stringArraySchema.default([]),
		fileNames: stringArraySchema.default([]),
		rootMarkers: stringArraySchema.optional(),
		capabilities: stringArraySchema.default([]),
		config: unknownRecordSchema.optional(),
	})
	.superRefine(
		(value: AdapterManifestRefinementInput, ctx: RefinementContext) => {
		const executableKinds = new Set(["formatter", "analyzer", "transport"]);
		if (executableKinds.has(value.kind) && !value.command) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["command"],
				message: `Adapter kind ${value.kind} requires a command.`,
			});
		}
	});

export const providerSourceSchema = z.enum([
	"built-in",
	"workspace",
	"adapter-compat",
	"code-backed",
]);

export const providerRuntimeSchema = z.enum(["bun", "legacy", "handler"]);

export const providerManifestSchema = z
	.object({
		id: z.string().min(1),
		kind: adapterKindSchema,
		runtime: providerRuntimeSchema.default("bun"),
		command: z.string().min(1).optional(),
		args: stringArraySchema.optional(),
		env: stringRecordSchema.optional(),
		extensions: stringArraySchema.default([]),
		fileNames: stringArraySchema.default([]),
		rootMarkers: stringArraySchema.optional(),
		capabilities: stringArraySchema.default([]),
		handler: z.string().min(1).optional(),
		parser: z.string().min(1).optional(),
		resolver: z.string().min(1).optional(),
		config: unknownRecordSchema.optional(),
	})
	.superRefine(
		(value: ProviderManifestRefinementInput, ctx: RefinementContext) => {
			const executableKinds = new Set(["lsp", "formatter", "analyzer", "transport"]);
			if (!executableKinds.has(value.kind)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["kind"],
					message: `Provider ${value.id || "<unknown>"} has unsupported kind ${value.kind}.`,
				});
			}
			if (value.runtime === "handler" && !value.handler) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["handler"],
					message: `Provider ${value.id} uses handler runtime but is missing handler.`,
				});
			}
			if (value.runtime !== "handler" && !value.command && !value.handler) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["command"],
					message: `Provider ${value.id} is missing command or handler.`,
				});
			}
		},
	);

export const commandPreferenceSchema = z
	.object({
		timeoutMs: positiveInt.optional(),
		formatter: z.string().min(1).optional(),
		analyzers: stringArraySchema.optional(),
		lspServer: z.string().min(1).optional(),
	})
	.passthrough();

export const openLspConfigSchema = z
	.object({
		extends: z.union([z.string().min(1), stringArraySchema]).optional(),
		workspaceRoot: z.string().min(1).optional(),
		output: z
			.object({
				defaultFormat: outputFormatSchema.optional(),
			})
			.passthrough()
			.optional(),
		lsp: z
			.object({
				enabled: z.boolean().optional(),
				pythonProvider: pythonProviderSchema.optional(),
				servers: z.record(z.string(), adapterOverrideSchema).optional(),
			})
			.passthrough()
			.optional(),
		formatter: z
			.object({
				enabled: z.boolean().optional(),
				formatters: z.record(z.string(), adapterOverrideSchema).optional(),
			})
			.passthrough()
			.optional(),
		analyzer: z
			.object({
				enabled: z.boolean().optional(),
				analyzers: z.record(z.string(), adapterOverrideSchema).optional(),
			})
			.passthrough()
			.optional(),
		commands: z.record(z.string(), commandPreferenceSchema).optional(),
		adapters: z.array(adapterManifestSchema).optional(),
		providers: z.array(providerManifestSchema).optional(),
		remote: z
			.object({
				enabled: z.boolean().optional(),
				host: z.string().min(1).optional(),
				port: z.number().int().positive().max(65535).optional(),
				timeoutMs: positiveInt.optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

const commonRequestShape = {
	cwd: z.string().min(1).optional(),
	workspaceRoot: z.string().min(1).optional(),
	configPath: z.string().min(1).optional(),
	output: outputFormatSchema.optional(),
	sessionId: z.string().min(1).optional(),
	timeoutMs: positiveInt.optional(),
};

export const lspCommandSchema = z
	.object({
		command: z.literal("lsp"),
		operation: lspOperationSchema,
		filePath: z.string().min(1).optional(),
		filePaths: stringArraySchema.optional(),
		line: positiveInt.optional(),
		character: positiveInt.optional(),
		endLine: positiveInt.optional(),
		endCharacter: positiveInt.optional(),
		newName: z.string().min(1).optional(),
		severity: severitySchema.optional(),
		...commonRequestShape,
	})
	.superRefine((value: LspCommandRefinementInput, ctx: RefinementContext) => {
		const positionRequired = new Set([
			"goToDefinition",
			"findReferences",
			"hover",
			"documentHighlight",
			"goToImplementation",
			"typeDefinition",
			"prepareCallHierarchy",
			"incomingCalls",
			"outgoingCalls",
			"signatureHelp",
			"rename",
			"prepareRename",
			"codeAction",
		]);
		const fileRequired = new Set([
			"goToDefinition",
			"findReferences",
			"hover",
			"documentHighlight",
			"documentSymbol",
			"workspaceSymbol",
			"goToImplementation",
			"typeDefinition",
			"prepareCallHierarchy",
			"incomingCalls",
			"outgoingCalls",
			"diagnostics",
			"signatureHelp",
			"rename",
			"prepareRename",
			"foldingRange",
			"codeAction",
		]);

		if (fileRequired.has(value.operation) && !value.filePath) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["filePath"],
				message: `operation ${value.operation} requires filePath`,
			});
		}
		if (
			value.operation === "workspaceDiagnostics" &&
			(!value.filePaths || value.filePaths.length === 0)
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["filePaths"],
				message: "workspaceDiagnostics requires filePaths",
			});
		}
		if (
			positionRequired.has(value.operation) &&
			(value.line === undefined || value.character === undefined)
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["line"],
				message: `operation ${value.operation} requires line and character`,
			});
		}
		if (value.operation === "rename" && !value.newName) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["newName"],
				message: "rename requires newName",
			});
		}
		if ((value.endLine === undefined) !== (value.endCharacter === undefined)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: value.endLine === undefined ? ["endLine"] : ["endCharacter"],
				message: "endLine and endCharacter must be provided together",
			});
		}
	});

export const formatCommandSchema = z.object({
	command: z.literal("format"),
	filePath: z.string().min(1),
	...commonRequestShape,
});

export const analyzeCommandSchema = z.object({
	command: z.literal("analyze"),
	filePath: z.string().min(1),
	...commonRequestShape,
});

export const configCommandSchema = z.object({
	command: z.literal("config"),
	...commonRequestShape,
});

export const capabilitiesCommandSchema = z.object({
	command: z.literal("capabilities"),
	...commonRequestShape,
});

export const closeSessionCommandSchema = z.object({
	command: z.literal("session.close"),
	...commonRequestShape,
	sessionId: z.string().min(1),
});

export const commandRequestSchema = z.discriminatedUnion("command", [
	lspCommandSchema,
	formatCommandSchema,
	analyzeCommandSchema,
	configCommandSchema,
	capabilitiesCommandSchema,
	closeSessionCommandSchema,
]);

export const workspaceMetadataSchema = z.object({
	cwd: z.string(),
	root: z.string(),
	configSources: z.array(z.string()),
});

export const sessionMetadataSchema = z
	.object({
		id: z.string(),
		reused: z.boolean(),
	})
	.optional();

export const commandMetadataSchema = z.object({
	durationMs: z.number().nonnegative(),
	adapterIds: z.array(z.string()).optional(),
	adapterId: z.string().optional(),
	backend: z.string().optional(),
	warnings: z.array(z.string()).default([]),
	source: z.string().optional(),
});

export const successEnvelopeSchema = z.object({
	protocolVersion: z.literal(PROTOCOL_VERSION),
	status: z.literal("ok"),
	runtime: z.literal("bun"),
	mode: z.enum(["local", "remote"]),
	command: z.string(),
	workspace: workspaceMetadataSchema,
	session: sessionMetadataSchema,
	metadata: commandMetadataSchema,
	data: z.unknown(),
});

export const errorEnvelopeSchema = z.object({
	protocolVersion: z.literal(PROTOCOL_VERSION),
	status: z.literal("error"),
	runtime: z.literal("bun"),
	mode: z.enum(["local", "remote"]),
	command: z.string(),
	workspace: workspaceMetadataSchema,
	session: sessionMetadataSchema,
	metadata: commandMetadataSchema,
	error: z.object({
		code: z.string(),
		message: z.string(),
		retryable: z.boolean().optional(),
		details: z.unknown().optional(),
	}),
});

export const commandEnvelopeSchema = z.union([
	successEnvelopeSchema,
	errorEnvelopeSchema,
]);

export type AdapterKind = "lsp" | "formatter" | "analyzer" | "transport";
export type AdapterRuntime = "bun" | "legacy";
export type ProviderKind = AdapterKind;
export type ProviderSource =
	| "built-in"
	| "workspace"
	| "adapter-compat"
	| "code-backed";
export type ProviderRuntime = "bun" | "legacy" | "handler";
export type Severity = "all" | "error" | "warning" | "info" | "hint";
export type OutputFormat = "text" | "json";

export interface AdapterOverride {
	disabled?: boolean;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	environment?: Record<string, string>;
	extensions?: string[];
	fileNames?: string[];
	rootMarkers?: string[];
	runtime?: AdapterRuntime;
	[key: string]: unknown;
}

export interface AdapterManifest {
	id: string;
	kind: AdapterKind;
	runtime: AdapterRuntime;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	extensions: string[];
	fileNames: string[];
	rootMarkers?: string[];
	capabilities: string[];
	config?: Record<string, unknown>;
}

export interface ProviderManifest {
	id: string;
	kind: ProviderKind;
	runtime: ProviderRuntime;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	extensions: string[];
	fileNames: string[];
	rootMarkers?: string[];
	capabilities: string[];
	handler?: string;
	parser?: string;
	resolver?: string;
	config?: Record<string, unknown>;
}

export interface CommandPreference {
	timeoutMs?: number;
	formatter?: string;
	analyzers?: string[];
	lspServer?: string;
	[key: string]: unknown;
}

export interface OpenLspConfig {
	extends?: string | string[];
	workspaceRoot?: string;
	output?: { defaultFormat?: OutputFormat; [key: string]: unknown };
	lsp?: {
		enabled?: boolean;
		pythonProvider?: "pyright" | "basedpyright" | "ty";
		servers?: Record<string, AdapterOverride>;
		[key: string]: unknown;
	};
	formatter?: {
		enabled?: boolean;
		formatters?: Record<string, AdapterOverride>;
		[key: string]: unknown;
	};
	analyzer?: {
		enabled?: boolean;
		analyzers?: Record<string, AdapterOverride>;
		[key: string]: unknown;
	};
	commands?: Record<string, CommandPreference>;
	adapters?: AdapterManifest[];
	providers?: ProviderManifest[];
	remote?: {
		enabled?: boolean;
		host?: string;
		port?: number;
		timeoutMs?: number;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export type LspOperation =
	| "goToDefinition"
	| "findReferences"
	| "hover"
	| "documentHighlight"
	| "documentSymbol"
	| "workspaceSymbol"
	| "goToImplementation"
	| "typeDefinition"
	| "prepareCallHierarchy"
	| "incomingCalls"
	| "outgoingCalls"
	| "diagnostics"
	| "workspaceDiagnostics"
	| "signatureHelp"
	| "rename"
	| "prepareRename"
	| "foldingRange"
	| "codeAction";

interface CommonCommandRequest {
	cwd?: string;
	workspaceRoot?: string;
	configPath?: string;
	output?: OutputFormat;
	sessionId?: string;
	timeoutMs?: number;
}

export type CommandRequest =
	| (CommonCommandRequest & {
			command: "lsp";
			operation: LspOperation;
			filePath?: string;
			filePaths?: string[];
			line?: number;
			character?: number;
			endLine?: number;
			endCharacter?: number;
			newName?: string;
			severity?: Severity;
	  })
	| (CommonCommandRequest & { command: "format"; filePath: string })
	| (CommonCommandRequest & { command: "analyze"; filePath: string })
	| (CommonCommandRequest & { command: "config" })
	| (CommonCommandRequest & { command: "capabilities" })
	| (CommonCommandRequest & {
			command: "session.close";
			sessionId: string;
	  });

interface CommandEnvelopeBase {
	protocolVersion: typeof PROTOCOL_VERSION;
	runtime: "bun";
	mode: "local" | "remote";
	command: string;
	workspace: {
		cwd: string;
		root: string;
		configSources: string[];
	};
	session?: {
		id: string;
		reused: boolean;
	};
	metadata: {
		durationMs: number;
		adapterIds?: string[];
		adapterId?: string;
		backend?: string;
		warnings: string[];
		source?: string;
		[key: string]: unknown;
	};
}

export type CommandEnvelope =
	| (CommandEnvelopeBase & {
			status: "ok";
			data: unknown;
	  })
	| (CommandEnvelopeBase & {
			status: "error";
			error: {
		code: string;
		message: string;
		retryable?: boolean;
		details?: unknown;
	};
	  });
