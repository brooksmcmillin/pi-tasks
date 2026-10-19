import {
	chmodSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	runWeekly,
	weeklyCutoff,
} from "../../src/compaction-report-delivery.ts";
import {
	createCollector,
	TelemetryStore,
} from "../../src/compaction-telemetry.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const path of dirs.splice(0))
		rmSync(path, { recursive: true, force: true });
});
function setup() {
	const root = mkdtempSync(join(tmpdir(), "pi-report-test-"));
	dirs.push(root);
	const telemetryDirectory = join(root, "telemetry"),
		outputDirectory = join(root, "reports");
	const store = new TelemetryStore(telemetryDirectory);
	let time = "2026-10-16T12:00:00.000Z";
	const collector = createCollector(
		store,
		() => {
			throw new Error("collector failed");
		},
		() => time,
	);
	collector.start({
		sessionManager: {
			getSessionId: () => "fixture",
			getHeader: () => ({ id: "fixture" }),
		},
	});
	collector.marker({
		version: 1,
		id: "assigned",
		kind: "checkpoint",
		cohort: "pilot",
	});
	collector.before({ attemptId: "fixture-attempt" });
	time = "2026-10-16T12:00:02.000Z";
	collector.complete({ compactionEntry: { id: "compacted" } });
	collector.marker({
		version: 1,
		id: "mismatch",
		kind: "recovery",
		recovery: { identity: "mismatch" },
	});
	return {
		telemetryDirectory,
		outputDirectory,
		now: new Date("2026-10-17T16:00:00Z"),
	};
}
describe("private weekly report delivery", () => {
	it("selects Saturday 09:00 LA before/at boundary and across DST", () => {
		expect(weeklyCutoff(new Date("2026-10-17T15:59:59Z")).toISOString()).toBe(
			"2026-10-10T16:00:00.000Z",
		);
		expect(weeklyCutoff(new Date("2026-10-17T16:00:00Z")).toISOString()).toBe(
			"2026-10-17T16:00:00.000Z",
		);
		expect(weeklyCutoff(new Date("2026-11-07T18:00:00Z")).toISOString()).toBe(
			"2026-11-07T17:00:00.000Z",
		);
		expect(weeklyCutoff(new Date("2026-03-14T18:00:00Z")).toISOString()).toBe(
			"2026-03-14T16:00:00.000Z",
		);
	});
	it("persists period history/latest and deduplicates weekly and concrete mismatch notices after restart", () => {
		const options = setup();
		const notices: string[] = [];
		const notify = ({ id }: { id: string }) => {
			notices.push(id);
		};
		expect(runWeekly({ ...options, notify }).sent).toBe(2);
		expect(runWeekly({ ...options, notify }).sent).toBe(0);
		expect(notices).toHaveLength(2);
		const latest = JSON.parse(
			readFileSync(join(options.outputDirectory, "latest.json"), "utf8"),
		);
		expect(latest.period).toBe("2026-10-17T16:00:00.000Z");
		for (const path of readdirSync(options.outputDirectory))
			expect(statSync(join(options.outputDirectory, path)).mode & 0o077).toBe(
				0,
			);
		const catchup = runWeekly({
			...options,
			now: new Date("2026-11-09T12:00:00Z"),
			notify,
		});
		expect(catchup.period).toBe("2026-11-07T17:00:00.000Z");
		expect(catchup.sent).toBe(1);
		expect(notices.filter((id) => !id.startsWith("weekly:"))).toHaveLength(1);
		expect(
			readdirSync(options.outputDirectory).filter((p) => /^2026/.test(p)),
		).toHaveLength(2);
	});
	it("retries pending notification failures without losing report history", () => {
		const options = setup();
		expect(() =>
			runWeekly({
				...options,
				notify: () => {
					throw new Error("offline");
				},
			}),
		).toThrow("offline");
		expect(readdirSync(options.outputDirectory)).toContain("latest.json");
		expect(runWeekly({ ...options, notify: () => {} }).sent).toBe(2);
	});
	it("keeps invalid input visible and rejects missing stores, public destinations and symlinks", () => {
		const options = setup();
		writeFileSync(join(options.telemetryDirectory, "corrupt"), "not-json");
		expect(runWeekly({ ...options, notify: () => {} }).invalidFiles).toBe(1);
		chmodSync(options.outputDirectory, 0o755);
		expect(() => runWeekly({ ...options, notify: () => {} })).toThrow(
			"private",
		);
		chmodSync(options.outputDirectory, 0o700);
		const file = join(options.outputDirectory, "latest.json");
		rmSync(file);
		symlinkSync(join(options.outputDirectory, "elsewhere"), file);
		expect(() => runWeekly({ ...options, notify: () => {} })).toThrow();
		expect(() =>
			runWeekly({
				...options,
				telemetryDirectory: join(options.telemetryDirectory, "missing"),
				notify: () => {},
			}),
		).toThrow();
	});
});
