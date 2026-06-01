import { z } from "zod/v4";

export const OPERATIONS = [
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
] as const;

export const SEVERITY_FILTERS = ["all", "error", "warning", "info", "hint"] as const;

export type Operation = (typeof OPERATIONS)[number];

const positiveInt = (description: string) => z
  .number()
  .int()
  .positive()
  .describe(description);

const filePathField = z.string().min(1).describe("Absolute or relative path to the file.");
const severityField = z.enum(SEVERITY_FILTERS).optional()
  .describe('Filter diagnostics: "all" | "error" | "warning" | "info" | "hint".');

const positionSchema = {
  line: positiveInt("1-based line number."),
  character: positiveInt("1-based character offset."),
};

const claudeCoreOperationSchema = z.strictObject({
  operation: z.enum([
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
  ]),
  filePath: filePathField,
  ...positionSchema,
});

const diagnosticsSchema = z.strictObject({
  operation: z.literal("diagnostics"),
  filePath: filePathField,
  severity: severityField,
});

const workspaceDiagnosticsSchema = z.strictObject({
  operation: z.literal("workspaceDiagnostics"),
  filePaths: z.array(filePathField).min(1).describe("File paths for workspaceDiagnostics."),
  severity: severityField,
});

const signatureHelpSchema = z.strictObject({
  operation: z.literal("signatureHelp"),
  filePath: filePathField,
  ...positionSchema,
});

const renameSchema = z.strictObject({
  operation: z.literal("rename"),
  filePath: filePathField,
  ...positionSchema,
  newName: z.string().min(1).describe("New symbol name for rename."),
});

const prepareRenameSchema = z.strictObject({
  operation: z.literal("prepareRename"),
  filePath: filePathField,
  ...positionSchema,
});

const foldingRangeSchema = z.strictObject({
  operation: z.literal("foldingRange"),
  filePath: filePathField,
});

const codeActionSchema = z.strictObject({
  operation: z.literal("codeAction"),
  filePath: filePathField,
  ...positionSchema,
  endLine: positiveInt("1-based end line for range operations.").optional(),
  endCharacter: positiveInt("1-based end character for range operations.").optional(),
}).superRefine((value, ctx) => {
  const hasEndLine = value.endLine !== undefined;
  const hasEndCharacter = value.endCharacter !== undefined;
  if (hasEndLine !== hasEndCharacter) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "endLine and endCharacter must be provided together.",
      path: hasEndLine ? ["endCharacter"] : ["endLine"],
    });
  }
});

export const lspToolInputSchema = z.discriminatedUnion("operation", [
  claudeCoreOperationSchema,
  diagnosticsSchema,
  workspaceDiagnosticsSchema,
  signatureHelpSchema,
  renameSchema,
  prepareRenameSchema,
  foldingRangeSchema,
  codeActionSchema,
]);

export type LspToolInput = z.infer<typeof lspToolInputSchema>;

export function parseLspToolInput(input: unknown): LspToolInput {
  return lspToolInputSchema.parse(input);
}

export function safeParseLspToolInput(input: unknown): ReturnType<typeof lspToolInputSchema.safeParse> {
  return lspToolInputSchema.safeParse(input);
}
