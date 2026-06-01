import { afterEach, expect, test } from "bun:test";
import { SessionService } from "../src/session-service.ts";

const service = new SessionService();
const activeSessions: string[] = [];

afterEach(async () => {
	while (activeSessions.length > 0) {
		const id = activeSessions.pop();
		if (id) {
			await service.closeSession(id);
		}
	}
});

test("SessionService reuses warm sessions for the same workspace and config", () => {
	const config = {
		lsp: { enabled: true },
		formatter: { enabled: true },
		analyzer: { enabled: true },
	};

	const first = service.ensureSession("/tmp/openlsp-workspace", config);
	const second = service.ensureSession("/tmp/openlsp-workspace", config);
	activeSessions.push(first.session.id);

	expect(first.reused).toBe(false);
	expect(second.reused).toBe(true);
	expect(second.session.id).toBe(first.session.id);
});
