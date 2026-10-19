import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCompactionPilot } from "../../src/compaction-pilot.ts";
import { RECOVERY_ENTRY } from "../../src/compaction-recovery.ts";
import {
	createCollector,
	type TelemetryRecord,
} from "../../src/compaction-telemetry.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	TaskToolResultEvent,
} from "../../src/pi-types.ts";
import { type BranchEntry, createTaskRuntimeStore } from "../../src/store.ts";

vi.mock("../../src/compaction-recovery.ts", async (original) => ({
	...(await original<typeof import("../../src/compaction-recovery.ts")>()),
	repositoryIdentity: () => ({
		cwd: "/fixture",
		branch: "pilot",
		head: "h1",
		dirtyStateReference: "d1",
	}),
}));
afterEach(() => vi.unstubAllEnvs());
function harness(entries: BranchEntry[] = []) {
	const store = createTaskRuntimeStore();
	store.append(
		{
			version: 1,
			id: "create",
			type: "task.created",
			taskId: "T1",
			createdAt: "2026-10-19T00:00:00Z",
			source: "tool",
			title: "Pilot fixture",
			objective: "Verify recovery continuity",
			acceptanceCriteria: ["Recovery checked"],
			planSteps: [
				{
					text: "Implement fixture behavior",
					expectedOutput: "One verified fixture",
					allowedActions: ["edit"],
				},
			],
			activate: true,
		},
		() => {},
	);
	const handlers = new Map<
		string,
		(event: never, ctx: ExtensionContext) => unknown
	>();
	const listeners = new Map<string, (data: unknown) => void>();
	const sendMessage = vi.fn();
	const records: TelemetryRecord[] = [];
	const collector = createCollector({ put: (r) => records.push(r) }, () => {});
	const pi = {
		on: (
			name: string,
			handler: (event: never, ctx: ExtensionContext) => unknown,
		) => handlers.set(name, handler),
		events: {
			emit: (name: string, data: unknown) => {
				listeners.get(name)?.(data);
				collector.marker(data);
			},
			on: (name: string, handler: (data: unknown) => void) => {
				listeners.set(name, handler);
				return () => listeners.delete(name);
			},
		},
		appendEntry: (customType: string, data: unknown) =>
			entries.push({ type: "custom", customType, data }),
		sendMessage,
	} as unknown as ExtensionAPI;
	let options: Parameters<NonNullable<ExtensionContext["compact"]>>[0];
	let calls = 0;
	const ctx: ExtensionContext = {
		cwd: "/fixture",
		sessionManager: { getBranch: () => entries, getSessionId: () => "root" },
		ui: { notify() {}, setStatus() {}, setWidget() {} },
		isIdle: () => true,
		getContextUsage: () => ({ tokens: 125_000, contextWindow: 1_000_000 }),
		hasPendingMessages: () => false,
		compact: (o) => {
			options = o;
			calls++;
		},
	};
	collector.start(ctx);
	const pilot = registerCompactionPilot(pi, store, () => false);
	const settle = (aborted = false) =>
		handlers.get("agent_settled")?.({ aborted } as never, ctx);
	const phase = () =>
		pilot.observeTool({
			toolName: "task_verify_step",
			isError: false,
			input: { task_id: "T1" },
		} as TaskToolResultEvent);
	return {
		store,
		entries,
		ctx,
		sendMessage,
		records,
		pilot,
		settle,
		phase,
		calls: () => calls,
		options: () => options,
	};
}
const user = {
	type: "message",
	id: "user-1",
	message: { role: "user" },
} as BranchEntry;
describe("idle native compaction pilot", () => {
	it("is opt-in and unknown checkpoints skip only pilot intervention", () => {
		const h = harness([user]);
		h.phase();
		h.settle();
		expect(h.calls()).toBe(0);
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "pilot");
		const unknown = harness();
		unknown.phase();
		unknown.settle();
		expect(unknown.calls()).toBe(0);
		expect(unknown.records.at(-1)?.policyDecision).toBe("unknown-checkpoint");
		expect(
			unknown.pilot.before({
				preparation: { settings: { keepRecentTokens: 1 } },
			}),
		).toBeUndefined();
	});
	it("persists cohort and exact checkpoint before native compaction, resumes exactly once", () => {
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "pilot");
		const h = harness([user]);
		h.phase();
		h.settle();
		expect(h.calls()).toBe(1);
		expect(h.entries.at(-1)?.customType).toBe(RECOVERY_ENTRY);
		expect(h.entries.at(-1)?.data).toMatchObject({
			taskId: "T1",
			stepId: "T1-S1",
			revision: "2026-10-19T00:00:00Z",
			authorizationSources: ["session-entry:user-1"],
			repository: { head: "h1" },
			children: [],
			nextAction: expect.any(String),
		});
		expect(
			h.pilot.before({
				customInstructions: h.options()?.customInstructions,
				preparation: { settings: { keepRecentTokens: 20_000 } },
			}),
		).toBeUndefined();
		h.options()?.onComplete?.();
		h.options()?.onComplete?.();
		expect(h.sendMessage).toHaveBeenCalledTimes(1);
		expect(h.sendMessage.mock.calls[0]?.[0].content).toContain(
			"Call task_resume",
		);
		expect(
			h.records.some(
				(r) => r.kind === "recovery" && r.recovery?.identity === "pass",
			),
		).toBe(true);
	});
	it("does not attribute other-task verification to the active phase", () => {
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "pilot");
		const h = harness([user]);
		h.pilot.observeTool({
			toolName: "task_verify_step",
			isError: false,
			input: { task_id: "T2" },
		});
		h.settle();
		expect(h.calls()).toBe(0);
		expect(h.records.at(-1)?.policyDecision).toBe("await-phase-boundary");
	});
	it("does not arm active-task fallback continuation from inactive creation or other-task mutation", () => {
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "pilot");
		for (const event of [
			{
				toolName: "task_plan",
				input: { activate: false },
				details: { taskId: "T1" },
			},
			{ toolName: "task_verify_step", input: { task_id: "T2" } },
			{ toolName: "task_update", input: { task_id: "T2" } },
			{ toolName: "task_plan", input: {}, details: {} },
		]) {
			const h = harness([user]);
			h.ctx.getContextUsage = () => ({
				tokens: 150_000,
				contextWindow: 1_000_000,
			});
			h.pilot.observeTool({ ...event, isError: false });
			h.settle();
			expect(h.calls()).toBe(1);
			h.options()?.onComplete?.();
			expect(h.sendMessage).not.toHaveBeenCalled();
		}
	});
	it("retains cohort across replay despite a new environment setting", () => {
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "baseline");
		const h = harness([user]);
		h.phase();
		h.settle();
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "pilot");
		const resumed = harness(h.entries);
		resumed.phase();
		resumed.settle();
		expect(resumed.calls()).toBe(0);
		expect(resumed.records.at(-1)?.policyDecision).toBe("baseline");
	});
	it("defers busy turns and triggers idle fallback without a phase marker", () => {
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "pilot");
		const h = harness([user]);
		h.ctx.isIdle = () => false;
		h.phase();
		h.settle();
		expect(h.calls()).toBe(0);
		h.ctx.isIdle = () => true;
		h.pilot.reset();
		h.ctx.getContextUsage = () => ({
			tokens: 150_000,
			contextWindow: 1_000_000,
		});
		h.settle();
		expect(h.calls()).toBe(1);
		expect(h.records.at(-1)?.policyDecision).toBe("fallback");
	});
	it("does not arm continuation from read-only recovery or checkpoint bookkeeping", () => {
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "pilot");
		const h = harness([user]);
		h.pilot.observeTool({
			toolName: "task_checkpoint",
			isError: false,
			input: {},
		});
		h.settle();
		h.options()?.onComplete?.();
		expect(h.calls()).toBe(1);
		expect(h.sendMessage).not.toHaveBeenCalled();
	});
	it("only cancels pilot-owned compaction with incompatible retention", () => {
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "pilot");
		const h = harness([user]);
		h.phase();
		h.settle();
		expect(
			h.pilot.before({
				customInstructions: "unrelated manual",
				preparation: { settings: { keepRecentTokens: 1 } },
			}),
		).toBeUndefined();
		expect(
			h.pilot.before({
				customInstructions: h.options()?.customInstructions,
				preparation: { settings: { keepRecentTokens: 1 } },
			}),
		).toEqual({ cancel: true });
		h.options()?.onError?.(new Error("cancelled"));
		expect(h.sendMessage).not.toHaveBeenCalled();
	});
	it("does not continue failure, input redirection, blocked tasks or shutdown", () => {
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "pilot");
		for (const change of ["failure", "redirect", "blocked", "shutdown"]) {
			const h = harness([user]);
			h.phase();
			h.settle();
			if (change === "failure")
				h.options()?.onError?.(new Error("fixture provider error"));
			if (change === "redirect") h.pilot.reset();
			if (change === "shutdown") h.pilot.shutdown();
			const task = h.store.getState().tasks.T1;
			if (change === "blocked" && task) task.status = "blocked";
			h.options()?.onComplete?.();
			expect(h.sendMessage).not.toHaveBeenCalled();
		}
	});
});
