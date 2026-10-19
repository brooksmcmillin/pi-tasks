// biome-ignore-all lint/style/noNonNullAssertion: Fixtures construct nonempty identities and rows; assertions check their semantics.
import { describe, expect, it } from "vitest";
import { buildReport, distribution } from "../../src/compaction-report.ts";
import {
	createCollector,
	identity,
	type TelemetryRecord,
} from "../../src/compaction-telemetry.ts";

function fixture() {
	const records: TelemetryRecord[] = [];
	let time = "2026-10-16T12:00:00.000Z";
	const collector = createCollector(
		{ put: (r) => records.push(r) },
		() => {
			throw new Error("collector failed");
		},
		() => time,
	);
	collector.start({
		sessionManager: {
			getSessionId: () => "root",
			getHeader: () => ({ id: "root" }),
		},
		model: { provider: "fixture", id: "test" },
		getContextUsage: () => ({ tokens: 20_000, contextWindow: 200_000 }),
	});
	collector.marker({
		version: 1,
		id: "start",
		kind: "phase_start",
		taskId: "task",
		phaseId: "phase",
		cohort: "pilot",
		configVersion: "cfg",
		policyVersion: "p1",
	});
	time = "2026-10-16T12:00:01.000Z";
	collector.before({
		attemptId: "try1",
		preparation: {
			tokensBefore: 120_000,
			settings: { reserveTokens: 20_000, keepRecentTokens: 20_000 },
		},
	});
	time = "2026-10-16T12:00:03.000Z";
	collector.complete({ willRetry: true }, true);
	time = "2026-10-16T12:00:04.000Z";
	collector.before({
		attemptId: "try2",
		preparation: { tokensBefore: 122_000 },
	});
	time = "2026-10-16T12:00:07.000Z";
	collector.complete({
		compactionEntry: {
			id: "ok",
			usage: { input: 100, output: 10, cacheRead: 0, cost: { total: 0 } },
		},
		willRetry: false,
	});
	collector.marker({
		version: 1,
		id: "recovered",
		kind: "recovery",
		recovery: {
			identity: "pass",
			authority: "mismatch",
			evidence: "unknown",
			children: "pass",
		},
	});
	time = "2026-10-16T12:00:08.000Z";
	collector.marker({
		version: 1,
		id: "useful",
		kind: "useful_action",
		outcome: "success",
	});
	collector.marker({
		version: 1,
		id: "cp1",
		kind: "checkpoint",
		evidenceId: "same",
	});
	collector.marker({
		version: 1,
		id: "cp2",
		kind: "checkpoint",
		evidenceId: "same",
	});
	time = "2026-10-16T12:00:10.000Z";
	collector.marker({ version: 1, id: "end", kind: "phase_end" });
	collector.end();
	return records;
}
const from = "2026-10-10T16:00:00.000Z",
	to = "2026-10-17T16:00:00.000Z";
const pilot = (rows: TelemetryRecord[], labels = {}) =>
	buildReport(rows, from, to, labels).cohorts.find(
		(c) => c.cohort === "pilot",
	)!;

describe("compaction cohort report", () => {
	it("retains unknown header roots and distinct task assignments within a session", () => {
		const rows = fixture();
		const other = rows.map((r) => ({
			...r,
			id: identity(`other:${r.id}`)!,
			taskId: identity("other-task"),
			cohort: "baseline" as const,
			sequence: r.sequence + 100,
		}));
		const report = buildReport([...rows, ...other], from, to);
		expect(report.quality.assignmentConflicts).toBe(0);
		expect(report.roots[0]?.cohort).toBe("mixed");
		expect(
			report.cohorts.find((c) => c.cohort === "baseline")?.assignedRoots,
		).toBe(1);
		expect(
			report.cohorts.find((c) => c.cohort === "pilot")?.assignedRoots,
		).toBe(1);
		const unknown = rows.map((r) => ({ ...r, rootId: null, parentId: null }));
		expect(buildReport(unknown, from, to).roots).toHaveLength(0);
		expect(buildReport(unknown, from, to).quality.unknownRootSessions).toBe(1);
	});
	it("retains taskless assignments in mixed-root denominators", () => {
		const rows = fixture();
		const first = {
			...rows[0]!,
			id: identity("taskless-baseline")!,
			cohort: "baseline" as const,
			taskId: null,
		};
		const report = buildReport([first, ...rows], from, to);
		expect(report.roots[0]?.cohort).toBe("mixed");
		expect(
			report.cohorts.find((c) => c.cohort === "baseline")?.assignedRoots,
		).toBe(1);
		expect(
			report.cohorts.find((c) => c.cohort === "pilot")?.assignedRoots,
		).toBe(1);
		expect(
			report.cohorts.find((c) => c.cohort === "baseline")?.events,
		).toBeGreaterThan(0);
	});
	it("computes median and nearest-rank p90 while retaining missingness and genuine zero", () => {
		expect(distribution([null, 0, 10, 20, 30])).toEqual({
			n: 4,
			missing: 1,
			median: 15,
			p90: 30,
		});
		expect(distribution([])).toEqual({
			n: 0,
			missing: 0,
			median: null,
			p90: null,
		});
	});
	it("includes compaction in wall-clock phase/task duration and measures recovery latency", () => {
		const p = pilot(fixture(), {
			tasks: {
				[identity("task")!]: {
					startedAt: "2026-10-16T12:00:00.000Z",
					completedAt: "2026-10-16T12:00:10.000Z",
					taskClass: "code",
				},
			},
		});
		expect(p.phaseDurationMs.median).toBe(10_000);
		expect(p.taskDurationMs.median).toBe(10_000);
		expect(p.compactions).toMatchObject({
			attempts: 2,
			success: 1,
			failures: 1,
			retrySignals: 1,
			incomplete: 0,
		});
		expect(p.compactions.durationMs.median).toBe(2500);
		expect(p.compactions.contextBefore.median).toBe(121_000);
		expect(p.compactions.contextAfter.median).toBe(20_000);
		expect(p.recovery.usefulActionLatencyMs.median).toBe(1000);
		expect(p.recovery.checks.authority).toEqual({
			pass: 0,
			mismatch: 1,
			unknown: 0,
		});
		expect(p.recovery.checks.evidence.unknown).toBe(1);
		expect(p.proxies.rereads).toBeNull();
		expect(p.proxies.repeatedEvidenceReferences).toBe(1);
		expect(p.cost).toMatchObject({
			n: 1,
			missing: 1,
			knownTotal: 0,
			complete: false,
		});
		expect(p.usage.cacheRead).toMatchObject({
			n: 1,
			missing: 1,
			knownTotal: 0,
		});
	});
	it("deduplicates replay and retains orphan, incomplete, unknown and abandoned denominators", () => {
		const rows = fixture();
		const incomplete = rows.filter(
			(r) =>
				r.kind !== "phase_end" &&
				r.kind !== "session_end" &&
				r.kind !== "compaction_end" &&
				r.kind !== "useful_action",
		);
		const p = pilot([...incomplete, ...incomplete], {
			tasks: { [identity("task")!]: { status: "abandoned" } },
		});
		expect(p.assignedRoots).toBe(1);
		expect(p.abandonedTasks).toBe(1);
		expect(p.compactions.incomplete).toBe(2);
		expect(p.phaseDurationMs).toMatchObject({ n: 0, missing: 1 });
		expect(p.taskDurationMs).toMatchObject({ n: 0, missing: 1 });
		expect(
			buildReport([...rows, ...rows], from, to).quality.replayedEvents,
		).toBe(rows.length);
		const orphan = pilot(
			rows.filter(
				(r) =>
					r.kind !== "compaction_start" &&
					r.kind !== "recovery" &&
					r.kind !== "useful_action",
			),
		);
		expect(orphan.compactions.orphanOutcomes).toBe(2);
		expect(orphan.recovery.checks.identity.unknown).toBe(1);
		expect(orphan.recovery.usefulActionLatencyMs.missing).toBe(1);
	});
	it("groups known children without creating independent samples and exposes unknown roots", () => {
		const rows = fixture();
		const child = rows.map((r) => ({
			...r,
			id: identity(`${r.id}-child`)!,
			sessionId: identity("child")!,
			parentId: identity("parent")!,
			rootId: identity("root")!,
		}));
		const unknown = {
			...child[0]!,
			id: identity("unknown")!,
			rootId: null,
			cohort: null,
		};
		const report = buildReport([...rows, ...child, unknown], from, to);
		expect(report.roots).toHaveLength(1);
		expect(report.roots[0]?.children).toBe(1);
		expect(report.quality.unknownRootSessions).toBe(1);
		expect(
			report.cohorts.find((c) => c.cohort === "pilot")?.assignedRoots,
		).toBe(1);
	});
	it("preserves earliest root assignment across windows/config/model strata and flags conflicts", () => {
		const rows = fixture();
		const conflict = {
			...rows.at(-1)!,
			id: identity("conflict")!,
			sequence: 100,
			cohort: "baseline" as const,
			model: identity("other"),
			configVersion: identity("new-config"),
			policyVersion: identity("new-policy"),
		};
		const report = buildReport([...rows, conflict], from, to, {
			tasks: { [identity("task")!]: { taskClass: "code" } },
			phases: { [identity("phase")!]: "implementation" },
		});
		expect(report.quality.assignmentConflicts).toBe(1);
		expect(report.roots[0]?.cohort).toBe("pilot");
		expect(
			report.strata.some(
				(s) =>
					s.dimensions[3] === "code" && s.dimensions[4] === "implementation",
			),
		).toBe(true);
		expect(
			report.strata.some((s) => s.dimensions[2] === identity("other")),
		).toBe(true);
		expect(
			report.strata.some(
				(s) =>
					s.dimensions[5] === identity("p1") &&
					s.dimensions[6] === identity("cfg"),
			),
		).toBe(true);
		expect(
			report.strata.some(
				(s) =>
					s.dimensions[5] === identity("new-policy") &&
					s.dimensions[6] === identity("new-config") &&
					s.dimensions[2] === identity("other"),
			),
		).toBe(true);
		expect(
			report.strata.some(
				(s) =>
					s.dimensions[6] === identity("cfg") &&
					s.dimensions[5] === identity("new-policy"),
			),
		).toBe(false);
		const later = buildReport(rows, "2026-10-16T12:00:06.000Z", to);
		expect(later.roots[0]?.cohort).toBe("pilot");
	});
	it.each([
		["2026-10-17T08:30:00-07:00", 0],
		["2026-10-17T09:30:00-07:00", 1],
		["2026-10-17T16:00:00.000Z", 1],
		["2026-10-17T15:59:59.000Z", 0],
		["!", 1],
		["", 1],
	])(
		"compares completion label %s as an instant without inventing completion",
		(completedAt, incomplete) => {
			const p = pilot(fixture(), {
				tasks: {
					[identity("task")!]: {
						startedAt: "2026-10-16T12:00:00Z",
						completedAt,
					},
				},
			});
			expect(p.incompleteTasks).toBe(incomplete);
			expect(p.taskDurationMs.n).toBe(incomplete ? 0 : 1);
		},
	);
	it("empty/small reports explicitly decline adoption, and shutdown is not completion", () => {
		expect(buildReport([], from, to).conclusion.adopt).toBe(false);
		expect(pilot(fixture()).incompleteTasks).toBe(1);
		expect(buildReport(fixture(), from, to).conclusion.reason).toContain(
			"Non-adoption",
		);
		expect(() => buildReport([], to, from)).toThrow("Invalid report period");
	});
});
