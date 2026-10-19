import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	coverage,
	createCollector,
	identity,
	PHASE_EVENT,
	TelemetryStore,
	usage,
} from "../../src/compaction-telemetry.ts";
import telemetry from "../../telemetry.ts";

const directories: string[] = [];
afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
	vi.unstubAllEnvs();
});
function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "pi-telemetry-"));
	directories.push(directory);
	const store = new TelemetryStore(directory);
	const warn = vi.fn();
	let time = Date.parse("2026-10-18T19:00:00Z");
	const context = {
		sessionManager: {
			getSessionId: () => "session-a",
			getLeafId: () => "entry-1",
			getHeader: () => ({ id: "session-a" }),
		},
		getContextUsage: () => ({
			tokens: 120000 as number | null,
			contextWindow: 200000,
		}),
		model: { provider: "provider", id: "model" },
	};
	const collector = createCollector(store, warn, () =>
		new Date(time).toISOString(),
	);
	collector.start(context);
	return {
		directory,
		store,
		warn,
		context,
		collector,
		advance: () => {
			time += 75;
		},
	};
}
const before = {
	reason: "threshold",
	willRetry: false,
	preparation: {
		tokensBefore: 125000,
		settings: { reserveTokens: 80000, keepRecentTokens: 20000 },
	},
};

describe("passive compaction telemetry", () => {
	it("correlates phases, checkpoint/recovery references and successful compaction without confusing context and usage", () => {
		const f = fixture();
		f.collector.marker({
			version: 1,
			id: "phase-1",
			kind: "phase_start",
			rootSessionId: "root",
			taskId: "task-1",
			phaseId: "phase",
			policyVersion: "native-v1",
			configVersion: "config-v1",
			cohort: "baseline",
		});
		f.collector.marker({
			version: 1,
			id: "checkpoint-1",
			kind: "checkpoint",
			checkpointId: "checkpoint",
		});
		f.collector.before(before);
		f.advance();
		f.collector.complete({
			reason: "threshold",
			willRetry: false,
			compactionEntry: {
				id: "compact-1",
				timestamp: "2026-10-18T19:00:00Z",
				usage: { input: 4000, output: 100, cacheRead: 0, cost: { total: 0 } },
			},
		});
		f.collector.marker({
			version: 1,
			id: "recovery-1",
			kind: "recovery",
			checkpointId: "checkpoint",
			evidenceId: "evidence",
			recovery: { identity: "pass", authority: "mismatch" },
		});
		const records = f.store.read().records;
		const start = records.find((r) => r.kind === "compaction_start");
		const end = records.find((r) => r.kind === "compaction_end");
		assert(start && end);
		expect(start.compactionId).toBe(end.compactionId);
		expect(end).toMatchObject({
			schemaVersion: 1,
			taskId: identity("task-1"),
			phaseId: identity("phase"),
			rootId: identity("root"),
			cohort: "baseline",
			policyVersion: identity("native-v1"),
			outcome: "success",
			durationMs: 75,
			missingStart: false,
		});
		expect(start.context).toMatchObject({
			tokens: 125000,
			provenance: "preparation",
		});
		expect(end.usage).toMatchObject({
			scope: "operation",
			input: 4000,
			output: 100,
			cacheRead: 0,
			cacheWrite: null,
			cost: { total: 0 },
		});
		expect(records.find((r) => r.kind === "recovery")?.recovery).toEqual({
			identity: "pass",
			authority: "mismatch",
			evidence: "unknown",
			children: "unknown",
		});
		expect(coverage(records).incompleteCompactions).toEqual([]);
	});
	it.each([false, true])(
		"pairs failure or abort, omitting error content (%s)",
		(aborted) => {
			const f = fixture();
			f.collector.before(before);
			f.advance();
			f.collector.complete(
				{
					reason: "overflow",
					willRetry: true,
					aborted,
					errorMessage: "SECRET",
				},
				true,
			);
			expect(
				f.store.read().records.find((r) => r.kind === "compaction_end"),
			).toMatchObject({
				outcome: aborted ? "abort" : "failure",
				reason: "overflow",
				willRetry: true,
				durationMs: 75,
			});
			expect(JSON.stringify(f.store.read())).not.toContain("SECRET");
		},
	);
	it("preserves nulls, zeroes, post-compaction unknown context and rejects invalid counters", () => {
		expect(
			usage({
				input: 0,
				output: -1,
				cacheRead: Infinity,
				cost: { total: NaN },
			}),
		).toMatchObject({
			input: 0,
			output: null,
			cacheRead: null,
			cost: { total: null },
		});
		const f = fixture();
		f.context.getContextUsage = () => ({ tokens: null, contextWindow: 200000 });
		f.collector.message({
			message: { role: "assistant", usage: { input: 0 }, stopReason: "error" },
		});
		expect(
			f.store.read().records.find((r) => r.kind === "usage"),
		).toMatchObject({
			context: { tokens: null },
			usage: { input: 0 },
			outcome: "failure",
		});
	});
	it("deduplicates event replay and restart, retaining phase/policy correlation and incomplete attempts", () => {
		const f = fixture();
		const marker = {
			version: 1,
			id: "phase-marker",
			kind: "phase_start",
			taskId: "task",
			phaseId: "phase",
			policyVersion: "native-v1",
		};
		f.collector.marker(marker);
		f.collector.marker(marker);
		f.collector.before(before);
		const restarted = createCollector(f.store, f.warn);
		restarted.start(f.context);
		restarted.marker(marker);
		restarted.message({
			message: { role: "assistant", timestamp: 1, usage: { input: 1 } },
		});
		restarted.message({
			message: { role: "assistant", timestamp: 1, usage: { input: 1 } },
		});
		restarted.complete({ compactionEntry: { id: "orphan" } });
		restarted.complete({ compactionEntry: { id: "orphan" } });
		const records = f.store.read().records;
		expect(records.filter((r) => r.kind === "session_start")).toHaveLength(1);
		expect(records.filter((r) => r.kind === "phase_start")).toHaveLength(1);
		expect(records.filter((r) => r.kind === "usage")).toHaveLength(1);
		expect(records.filter((r) => r.kind === "compaction_end")).toHaveLength(1);
		expect(records.find((r) => r.kind === "usage")).toMatchObject({
			taskId: identity("task"),
			phaseId: identity("phase"),
			policyVersion: identity("native-v1"),
		});
		expect(coverage(records)).toMatchObject({
			incompleteCompactions: [expect.any(String)],
			orphanOutcomes: [expect.any(String)],
			incompletePhases: [identity("phase")],
			sessionsWithoutEnd: [identity("session-a")],
		});
	});
	it("keeps distinct pre-persistence messages and deduplicates replay at another leaf and after restart", () => {
		const f = fixture();
		const first = {
			message: {
				role: "assistant",
				timestamp: 1,
				usage: { input: 12 },
				stopReason: "stop",
			},
		};
		const second = {
			message: {
				role: "assistant",
				timestamp: 2,
				usage: { input: 12 },
				stopReason: "stop",
			},
		};
		f.collector.message(first);
		f.collector.message(second);
		f.context.sessionManager.getLeafId = () =>
			"different-leaf-after-persistence";
		f.collector.message(first);
		const restarted = createCollector(f.store, f.warn);
		restarted.start(f.context);
		restarted.message(first);
		restarted.message(second);
		expect(
			f.store.read().records.filter((r) => r.kind === "usage"),
		).toHaveLength(2);
	});
	it("duplicate starts preserve timing/config and cannot replace a newer attempt after restart", () => {
		const f = fixture();
		const start = { ...before, attemptId: "stable-first" };
		f.collector.before(start);
		f.advance();
		f.collector.before({
			...start,
			preparation: { settings: { reserveTokens: 1 } },
		});
		f.advance();
		f.collector.complete({ compactionEntry: { id: "first-end" } });
		const records = f.store.read().records;
		const first = records.find((r) => r.kind === "compaction_start");
		const end = records.find((r) => r.kind === "compaction_end");
		assert(first && end);
		expect(end.durationMs).toBe(150);
		expect(end.configVersion).toBe(first.configVersion);
		const restarted = createCollector(f.store, f.warn);
		restarted.start(f.context);
		restarted.before({ ...before, attemptId: "stable-new" });
		restarted.before(start);
		restarted.complete({ compactionEntry: { id: "new-end" } });
		expect(
			f.store
				.read()
				.records.find(
					(r) =>
						r.kind === "compaction_end" &&
						r.compactionId === identity("stable-new"),
				),
		).toBeDefined();
		expect(coverage(f.store.read().records).incompleteCompactions).toEqual([]);
	});
	it("duplicate old terminal is state-neutral even while a newer attempt is pending and after restart", () => {
		const f = fixture();
		const terminal = { compactionEntry: { id: "first-terminal" } };
		f.collector.before(before);
		f.collector.complete(terminal);
		const original = f.store
			.read()
			.records.find((r) => r.kind === "compaction_end")?.compactionId;
		f.collector.complete(terminal);
		f.collector.marker({ version: 1, id: "recovery-first", kind: "recovery" });
		expect(
			f.store.read().records.find((r) => r.kind === "recovery")?.compactionId,
		).toBe(original);
		f.collector.before(before);
		f.collector.complete(terminal);
		f.collector.complete({ compactionEntry: { id: "second-terminal" } });
		const second = f.store
			.read()
			.records.find(
				(r) => r.kind === "compaction_end" && r.compactionId !== original,
			)?.compactionId;
		const restarted = createCollector(f.store, f.warn);
		restarted.start(f.context);
		restarted.complete(terminal);
		restarted.marker({ version: 1, id: "useful", kind: "useful_action" });
		expect(
			f.store.read().records.find((r) => r.kind === "useful_action")
				?.compactionId,
		).toBe(second);
		expect(coverage(f.store.read().records).incompleteCompactions).toEqual([]);
	});
	it("restores completed compaction independently of interrupted starts and targeted recovery markers", () => {
		const f = fixture();
		f.collector.before(before);
		f.collector.complete({ compactionEntry: { id: "completed" } });
		const completed = f.store
			.read()
			.records.find((r) => r.kind === "compaction_end")?.compactionId;
		f.collector.before(before);
		const restarted = createCollector(f.store, f.warn);
		restarted.start(f.context);
		restarted.marker({
			version: 1,
			id: "after-interruption",
			kind: "recovery",
		});
		expect(
			f.store
				.read()
				.records.filter((r) => r.kind === "recovery")
				.at(-1)?.compactionId,
		).toBe(completed);
		restarted.marker({
			version: 1,
			id: "target-old",
			kind: "recovery",
			compactionId: "old-raw-attempt",
		});
		const again = createCollector(f.store, f.warn);
		again.start(f.context);
		again.marker({
			version: 1,
			id: "implicit-after-old-target",
			kind: "useful_action",
		});
		expect(
			f.store.read().records.find((r) => r.kind === "useful_action")
				?.compactionId,
		).toBe(completed);
		expect(coverage(f.store.read().records).incompleteCompactions).toHaveLength(
			1,
		);
	});
	it("keeps unknown phases and cross-session or earlier ends incomplete", () => {
		const f = fixture();
		f.collector.marker({
			version: 1,
			id: "unknown-start",
			kind: "phase_start",
		});
		f.collector.marker({ version: 1, id: "unknown-end", kind: "phase_end" });
		f.collector.marker({
			version: 1,
			id: "earlier-end",
			kind: "phase_end",
			phaseId: "shared",
		});
		f.collector.marker({
			version: 1,
			id: "known-start",
			kind: "phase_start",
			phaseId: "shared",
		});
		const other = createCollector(f.store, f.warn);
		other.start({
			...f.context,
			sessionManager: { getSessionId: () => "other" },
		});
		other.marker({
			version: 1,
			id: "other-end",
			kind: "phase_end",
			phaseId: "shared",
		});
		expect(coverage(f.store.read().records).incompletePhases).toEqual([
			null,
			identity("shared"),
		]);
		f.collector.marker({ version: 1, id: "known-end", kind: "phase_end" });
		expect(coverage(f.store.read().records).incompletePhases).toEqual([null]);
	});
	it("preserves the complete nullable attempt snapshot while restoring newer live marker context", () => {
		const f = fixture();
		f.collector.before(before);
		f.collector.marker({
			version: 1,
			id: "mid-attempt",
			kind: "checkpoint",
			taskId: "later-task",
			phaseId: "later-phase",
			checkpointId: "later-checkpoint",
			rootSessionId: "later-root",
			policyVersion: "later-policy",
			configVersion: "later-config",
			cohort: "pilot",
		});
		f.collector.bind({
			...f.context,
			model: { provider: "other", id: "later-model" },
		});
		f.collector.complete({ compactionEntry: { id: "snapshot-terminal" } });
		const records = f.store.read().records;
		const start = records.find((r) => r.kind === "compaction_start");
		const end = records.find((r) => r.kind === "compaction_end");
		assert(start && end);
		for (const key of [
			"rootId",
			"parentId",
			"taskId",
			"phaseId",
			"checkpointId",
			"policyVersion",
			"configVersion",
			"cohort",
			"provider",
			"model",
		] as const)
			expect(end[key]).toBe(start[key]);
		expect(end.taskId).toBeNull();
		expect(end.phaseId).toBeNull();
		expect(end.checkpointId).toBeNull();
		const restarted = createCollector(f.store, f.warn);
		restarted.start(f.context);
		restarted.marker({
			version: 1,
			id: "after-restart-snapshot",
			kind: "useful_action",
		});
		expect(
			f.store.read().records.find((r) => r.kind === "useful_action"),
		).toMatchObject({
			taskId: identity("later-task"),
			phaseId: identity("later-phase"),
			checkpointId: identity("later-checkpoint"),
			rootId: identity("later-root"),
		});
	});
	it("exposes a missing persisted start after a transient sink failure", () => {
		const f = fixture();
		const collector = createCollector(
			{
				put: (record) => {
					if (record.kind === "compaction_start")
						throw new Error("transient sink failure");
					f.store.put(record);
				},
				read: () => f.store.read(),
			},
			f.warn,
		);
		collector.start(f.context);
		expect(collector.before(before)).toBeUndefined();
		collector.complete({ compactionEntry: { id: "end-after-lost-start" } });
		expect(f.warn).toHaveBeenCalledOnce();
		expect(
			f.store.read().records.find((r) => r.kind === "compaction_end")
				?.missingStart,
		).toBe(false);
		expect(coverage(f.store.read().records).orphanOutcomes).toHaveLength(1);
	});
	it("invalidates config metadata after model rebind and reports missing usage identity", () => {
		const f = fixture();
		f.collector.before(before);
		f.collector.complete({ compactionEntry: { id: "native" } });
		f.collector.bind({ ...f.context, model: { provider: "other", id: "new" } });
		f.collector.message({ message: { role: "assistant", timestamp: 10 } });
		f.collector.message({ message: { role: "assistant" } });
		const records = f.store.read().records.filter((r) => r.kind === "usage");
		expect(records.every((r) => r.configVersion === null)).toBe(true);
		expect(records.some((r) => r.missingIdentity)).toBe(true);
	});
	it("never serializes prompt, response, tool, secret, authorization or arbitrary marker strings", () => {
		const f = fixture();
		const secret =
			"SECRET prompt response tool-output Bearer token permission text";
		f.collector.marker({
			version: 1,
			id: secret,
			kind: "phase_start",
			taskId: secret,
			phaseId: secret,
			policyVersion: secret,
			configVersion: secret,
			rootSessionId: secret,
			checkpointId: secret,
			evidenceId: secret,
			compactionId: secret,
			cohort: secret,
			authorization: secret,
			content: secret,
		});
		f.collector.before({
			...before,
			customInstructions: secret,
			preparation: {
				...before.preparation,
				messagesToSummarize: [secret],
				previousSummary: secret,
			},
		});
		f.collector.complete({
			compactionEntry: { id: secret, summary: secret, details: secret },
			errorMessage: secret,
		});
		f.collector.message({
			message: {
				role: "assistant",
				content: secret,
				toolCalls: [secret],
				usage: { input: secret, cost: { total: secret } },
			},
		});
		expect(
			readdirSync(f.directory)
				.map((name) => readFileSync(join(f.directory, name), "utf8"))
				.join("\n"),
		).not.toContain("SECRET");
		expect(statSync(f.directory).mode & 0o777).toBe(0o700);
		for (const name of readdirSync(f.directory))
			expect(statSync(join(f.directory, name)).mode & 0o777).toBe(0o600);
	});
	it("counts syntactically valid malformed shapes and rejects content-bearing extra fields", () => {
		const f = fixture();
		const valid = f.store.read().records[0];
		assert(valid);
		const cases = [
			{
				schemaVersion: 1,
				id: valid.id,
				kind: "usage",
				timestamp: valid.timestamp,
			},
			{ ...valid, kind: "unsupported" },
			{ ...valid, sequence: "1" },
			{ ...valid, sessionId: "not-a-digest" },
			{ ...valid, context: { tokens: 0 } },
			{ ...valid, usage: { ...valid.usage, input: "secret" } },
			{
				...valid,
				usage: { ...valid.usage, cost: { ...valid.usage.cost, total: -1 } },
			},
			{ ...valid, recovery: { identity: "pass" } },
			{ ...valid, content: "SECRET" },
			{ ...valid, timestamp: "not-a-date" },
			{ ...valid, missingIdentity: null },
		];
		for (const record of cases) {
			writeFileSync(
				join(f.directory, `${valid.id}.json`),
				JSON.stringify(record),
				{ mode: 0o600 },
			);
			expect(f.store.read()).toEqual({ records: [], invalidFiles: 1 });
		}
		expect(() => f.store.put({ ...valid, id: "../../escape" })).toThrow(
			"Invalid telemetry record",
		);
	});
	it("rejects a FIFO without blocking the reader", () => {
		const f = fixture();
		const fifo = join(f.directory, `${"c".repeat(64)}.json`);
		const created = spawnSync("mkfifo", ["-m", "600", fifo], {
			encoding: "utf8",
			timeout: 2000,
			killSignal: "SIGKILL",
		});
		expect(created.error).toBeUndefined();
		expect(created.status).toBe(0);
		const module = new URL("../../src/compaction-telemetry.ts", import.meta.url)
			.href;
		const result = spawnSync(
			process.execPath,
			[
				"--experimental-strip-types",
				"--input-type=module",
				"-e",
				`import {TelemetryStore} from ${JSON.stringify(module)}; console.log(JSON.stringify(new TelemetryStore(${JSON.stringify(f.directory)}).read()));`,
			],
			{ encoding: "utf8", timeout: 2000, killSignal: "SIGKILL" },
		);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		const read = JSON.parse(result.stdout);
		expect(read.invalidFiles).toBe(1);
		expect(read.records).toHaveLength(1);
	});
	it("retains visibly invalid/truncated records and does not follow symlinks", () => {
		const f = fixture();
		writeFileSync(join(f.directory, `${"a".repeat(64)}.json`), "{", {
			mode: 0o600,
		});
		symlinkSync("/etc/passwd", join(f.directory, `${"b".repeat(64)}.json`));
		expect(f.store.read().invalidFiles).toBe(2);
		const link = join(f.directory, "link");
		symlinkSync(f.directory, link);
		expect(() => new TelemetryStore(link)).toThrow("private");
	});
	it("isolates sink, usage and warning failures without hook return values", () => {
		const warn = vi.fn(() => {
			throw new Error("UI failure");
		});
		const collector = createCollector(
			{
				put: () => {
					throw new Error("disk full");
				},
			},
			warn,
		);
		const f = fixture();
		expect(collector.start(f.context)).toBeUndefined();
		expect(collector.before(before)).toBeUndefined();
		expect(collector.complete({}, true)).toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(1);
	});
	it("flags resumed activity after old shutdown and records a later same-leaf shutdown once", () => {
		const f = fixture();
		f.collector.end();
		expect(coverage(f.store.read().records).sessionsWithoutEnd).toEqual([]);
		const restarted = createCollector(f.store, f.warn);
		restarted.start(f.context);
		// An idle resume with no new observation is not a claim about current process liveness.
		expect(coverage(f.store.read().records).sessionsWithoutEnd).toEqual([]);
		restarted.marker({
			version: 1,
			id: "resumed-activity",
			kind: "phase_start",
			phaseId: "resumed-phase",
		});
		expect(coverage(f.store.read().records).sessionsWithoutEnd).toEqual([
			identity("session-a"),
		]);
		restarted.end();
		restarted.end();
		const records = f.store.read().records;
		expect(coverage(records).sessionsWithoutEnd).toEqual([]);
		expect(records.filter((r) => r.kind === "session_end")).toHaveLength(2);
		expect(records.filter((r) => r.kind === "session_start")).toHaveLength(1);
	});
	it("keeps child roots unknown absent an explicit root marker", () => {
		const f = fixture();
		const child = createCollector(f.store, f.warn);
		child.start({
			...f.context,
			sessionManager: {
				getSessionId: () => "child",
				getHeader: () => ({
					id: "child",
					parentSession: "/private/parent.jsonl",
				}),
			},
		});
		expect(
			f.store.read().records.find((r) => r.sessionId === identity("child")),
		).toMatchObject({
			rootId: null,
			parentId: identity("/private/parent.jsonl"),
		});
	});
	it("wires native notifications and explicit markers without changing compaction or sending continuations", () => {
		const f = fixture();
		vi.stubEnv("PI_TASKS_TELEMETRY_DIR", f.directory);
		const handlers = new Map<
			string,
			(event: unknown, ctx: typeof f.context) => unknown
		>();
		const listeners = new Map<string, (value: unknown) => void>();
		const unsubscribe = vi.fn();
		telemetry({
			on: (name, handler) => {
				handlers.set(name, handler);
			},
			events: {
				on: (name, handler) => {
					listeners.set(name, handler);
					return unsubscribe;
				},
			},
		});
		const handler = (name: string) => {
			const result = handlers.get(name);
			assert(result);
			return result;
		};
		handler("session_start")({}, f.context);
		const marker = listeners.get(PHASE_EVENT);
		assert(marker);
		marker({
			version: 1,
			id: "explicit",
			kind: "phase_start",
			phaseId: "implementation",
		});
		expect(
			handler("session_before_compact")(before, f.context),
		).toBeUndefined();
		handler("session_compact")(
			{ compactionEntry: { id: "native" } },
			f.context,
		);
		handler("session_shutdown")({}, f.context);
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(
			f.store.read().records.some((r) => r.kind === "compaction_end"),
		).toBe(true);
	});
});
