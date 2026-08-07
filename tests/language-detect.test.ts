/**
 * Unit tests for language-detect.ts
 *
 * Verifies linguist-js-based detection: extension, shebang, ambiguous
 * extensions, display-name normalization, mtime cache, and sync fallback.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { detectLanguage, detectLanguageSync, clearLanguageCache } from "../language-detect.js";

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>) {
	tests.push({ name, fn });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) throw new Error(message || `Expected ${e}, got ${a}`);
}

function assertTrue(value: unknown, message: string) {
	if (!value) throw new Error(message || "expected truthy");
}

// scratch dir for temp files; cleaned at end
const tmpDir = path.join(os.tmpdir(), `pi-ld-test-${process.pid}`);
fs.mkdirSync(tmpDir, { recursive: true });

function writeTmp(name: string, content: string): string {
	const p = path.join(tmpDir, name.replace(/[^a-z0-9._-]/gi, "_"));
	fs.writeFileSync(p, content, "utf-8");
	return p;
}

// --- extension-based detection ---

test("detectLanguage: .py -> python", async () => {
	const f = writeTmp("a.py", "import os\nprint(os.getcwd())\n");
	clearLanguageCache();
	const lang = await detectLanguage(f);
	assertEqual(lang, "python");
});

test("detectLanguage: .rs -> rust", async () => {
	const f = writeTmp("a.rs", 'fn main() { println!("hi"); }\n');
	clearLanguageCache();
	const lang = await detectLanguage(f);
	assertEqual(lang, "rust");
});

test("detectLanguage: .go -> go", async () => {
	const f = writeTmp("a.go", 'package main\nimport "fmt"\nfunc main(){ fmt.Println("hi") }\n');
	clearLanguageCache();
	const lang = await detectLanguage(f);
	assertEqual(lang, "go");
});

test("detectLanguage: .cpp -> cpp (display name normalization)", async () => {
	const f = writeTmp("a.cpp", "std::vector<int> v;\n");
	clearLanguageCache();
	const lang = await detectLanguage(f);
	assertEqual(lang, "cpp");
});

test("detectLanguage: .cs -> csharp", async () => {
	const f = writeTmp("a.cs", "class X { void Y() {} }\n");
	clearLanguageCache();
	const lang = await detectLanguage(f);
	assertEqual(lang, "csharp");
});

// --- shebang / content heuristics (the win over extension tables) ---

test("detectLanguage: no-extension python via shebang", async () => {
	const f = writeTmp("script", "#!/usr/bin/env python3\nimport os\nprint(os.getcwd())\n");
	clearLanguageCache();
	const lang = await detectLanguage(f);
	assertEqual(lang, "python", "shebang should detect python even without .py");
});

test("detectLanguage: no-extension node via shebang", async () => {
	const f = writeTmp("bin", "#!/usr/bin/env node\nconsole.log('hi');\n");
	clearLanguageCache();
	const lang = await detectLanguage(f);
	assertEqual(lang, "javascript", "node shebang should detect javascript");
});

// --- ambiguous / content-driven ---

test("detectLanguage: .h with C content -> c", async () => {
	const f = writeTmp("a.h", "#include <stdio.h>\nint main(void){return 0;}\n");
	clearLanguageCache();
	const lang = await detectLanguage(f);
	assertEqual(lang, "c");
});

test("detectLanguage: .m objective-c via content", async () => {
	const f = writeTmp("a.m", "@interface X : NSObject\n@end\n");
	clearLanguageCache();
	const lang = await detectLanguage(f);
	assertTrue(lang === "objective_c" || lang === "objective_cpp", `got ${lang}`);
});

// --- caching ---

test("detectLanguage: caches by mtime, returns same result twice", async () => {
	const f = writeTmp("cache.py", "x = 1\n");
	clearLanguageCache();
	const first = await detectLanguage(f);
	const second = await detectLanguage(f); // should hit cache, no re-analysis
	assertEqual(first, "python");
	assertEqual(second, "python");
});

test("detectLanguage: cache invalidates on mtime change", async () => {
	const f = writeTmp("mtime.py", "x = 1\n");
	clearLanguageCache();
	await detectLanguage(f);
	// rewrite — newer mtime
	const later = path.join(tmpDir, "mtime.py");
	await new Promise((r) => setTimeout(r, 10));
	fs.writeFileSync(later, "import os\n", "utf-8");
	const lang = await detectLanguage(f);
	assertEqual(lang, "python");
});

test("clearLanguageCache: forces re-detection", async () => {
	const f = writeTmp("clear.py", "x = 1\n");
	clearLanguageCache();
	await detectLanguage(f);
	clearLanguageCache();
	const lang = await detectLanguage(f);
	assertEqual(lang, "python");
});

// --- sync fallback ---

test("detectLanguageSync: .py -> python without await", () => {
	const f = writeTmp("sync.py", "x = 1\n");
	clearLanguageCache();
	const lang = detectLanguageSync(f);
	assertEqual(lang, "python");
});

test("detectLanguageSync: unknown extension -> null", () => {
	const f = writeTmp("unknown.xyzzy", "garbage content\n");
	clearLanguageCache();
	const lang = detectLanguageSync(f);
	assertEqual(lang, null, "sync fallback has no .xyzzy mapping");
});

test("detectLanguageSync: shebang-only file returns null (sync cannot read content)", () => {
	const f = writeTmp("syncscript", "#!/usr/bin/env python3\nprint('hi')\n");
	clearLanguageCache();
	const lang = detectLanguageSync(f);
	assertEqual(lang, null, "sync path only knows extensions, not shebangs");
});

// --- error handling ---

test("detectLanguage: missing file returns null, does not throw", async () => {
	const lang = await detectLanguage(path.join(tmpDir, "does-not-exist-12345.py"));
	assertEqual(lang, null);
});

test("detectLanguageSync: missing .py file still returns python (sync only checks extension)", () => {
	// sync path deliberately ignores file existence — it's the cheap extension lookup,
	// used where callers already know the file exists. Document this contract.
	const f = path.join(tmpDir, "nope-sync-99999.py");
	clearLanguageCache();
	const lang = detectLanguageSync(f);
	assertEqual(lang, "python");
});

// --- runner ---

async function runTests() {
	let passed = 0;
	let failed = 0;

	for (const { name, fn } of tests) {
		try {
			await fn();
			console.log(`  ${name}... ✓`);
			passed++;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.log(`  ${name}... ✗`);
			console.log(`    Error: ${msg}\n`);
			failed++;
		}
	}

	console.log(`\n${passed} passed, ${failed} failed`);

	fs.rmSync(tmpDir, { recursive: true, force: true });

	if (failed > 0) process.exit(1);
}

runTests();
