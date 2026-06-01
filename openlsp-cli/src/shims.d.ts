declare module "node:path" {
	const value: any;
	export = value;
}

declare module "node:fs" {
	const value: any;
	export = value;
}

declare module "node:fs/promises" {
	const value: any;
	export = value;
}

declare module "node:os" {
	const value: any;
	export = value;
}

declare module "bun:test" {
	export const afterEach: any;
	export const expect: any;
	export const test: any;
}

declare module "zod" {
	export const z: any;
	export class ZodError extends Error {
		issues: Array<{ path: Array<string | number>; message: string }>;
	}
}

declare var Bun: any;
declare var process: any;
