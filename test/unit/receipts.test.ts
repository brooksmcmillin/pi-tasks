import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import {
	TASK_EVENT_CUSTOM_TYPE,
	type TaskEvent,
	type TaskResumeContext,
} from "../../src/model.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../../src/pi-types.ts";
import {
	buildTaskResume,
	formatTaskReceipt,
	formatTaskResume,
} from "../../src/render.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";
import { registerTaskTools } from "../../src/tools.ts";

function harness() {
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const entries: TaskEvent[] = [];
	const store = createTaskRuntimeStore();
	const pi: ExtensionAPI = {
		on: () => {},
		registerTool: (tool) => tools.set(tool.name, tool),
		registerCommand: () => {},
		appendEntry: (_type, data) => entries.push(data as TaskEvent),
	};
	const ctx: ExtensionContext = {
		sessionManager: {
			getBranch: () =>
				entries.map((data) => ({
					type: "custom",
					customType: TASK_EVENT_CUSTOM_TYPE,
					data,
				})),
		},
		ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
	};
	registerTaskTools(pi, store);
	const call = async (name: string, params: Record<string, unknown> = {}) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`Missing ${name}`);
		return tool.execute("receipt-test", params, undefined, undefined, ctx);
	};
	return { store, ctx, call };
}

const atomic = {
	isAtomic: true,
	reason: "One configuration result",
	canBeDoneInOneAgentAction: true,
	hasSingleObservableOutput: true,
	hasSingleVerificationMethod: true,
	hasNoHiddenSubtasks: true,
};
const plan = {
	title: "Receipt fixture",
	objective: "Verify compact execution receipts",
	acceptance_criteria: ["Configuration results pass"],
	plan_steps: [
		"Validate backend configuration",
		"Validate frontend configuration",
		"Validate worker configuration",
	].map((text) => ({
		text,
		expectedOutput: "Configuration regression report",
		allowedActions: ["bash"],
		decompositionStatus: "atomic",
		granularityCheck: atomic,
	})),
};
const quality = {
	source: "sanitized fixture",
	reproducible: true,
	verifier: "tool",
	command: "fixture-check",
	artifactRefs: ["fixture.log"],
	observedOutput: "Configuration check passed",
};
const proof = {
	type: "test",
	level: "unit_test",
	summary: "Configuration check passed",
	references: ["fixture.log"],
	quality,
};

async function plannedHarness() {
	const h = harness();
	const first = await h.call("task_plan", plan);
	expect(first.isError).not.toBe(true);
	const id = (first.details as TaskResumeContext).taskId;
	assert.ok(id);
	return { ...h, first, id };
}

function text(result: Awaited<ReturnType<ReturnType<typeof harness>["call"]>>) {
	return result.content.map((item) => item.text ?? "").join("\n");
}

describe("routine receipts", () => {
	it("keeps first use full, but removes unchanged recovery templates from routine successes", async () => {
		const h = await plannedHarness();
		expect(text(h.first)).toContain("pi-tasks resume");
		expect(text(h.first)).toContain("Minimum params:");
		const result = await h.call("task_update", {
			task_id: h.id,
			next_action: "Run configuration check",
		});
		expect(text(result)).toContain(`Task: ${h.id}`);
		expect(text(result)).toContain(`Current step: ${h.id}-S1`);
		expect(text(result)).toContain("Do now: task_verify_step");
		expect(text(result)).toContain(
			"Do not call: task_update done, task_complete",
		);
		expect(text(result)).not.toMatch(
			/pi-tasks resume|Lineage:|Instruction:|Minimum params:|Warnings:/,
		);
		expect(result.details).toEqual(buildTaskResume(h.store.getState()));
	});

	it("emits the changed execution contract on step advancement", async () => {
		const h = await plannedHarness();
		const result = await h.call("task_verify_step", {
			task_id: h.id,
			step_id: `${h.id}-S1`,
			...proof,
		});
		expect(result.isError).not.toBe(true);
		expect(text(result)).toContain(`Current step: ${h.id}-S2`);
		expect(text(result)).toContain("Step: Validate frontend configuration");
		expect(text(result)).toContain("Expected output:");
		expect(text(result)).toContain(`"step_id":"${h.id}-S2"`);
		expect(text(result)).toContain("Instruction:");
		expect(text(result)).toContain("New gaps:");
	});

	it("returns full explicit resume/focus and full contracts after replay or compaction checkpoint", async () => {
		const h = await plannedHarness();
		await h.call("task_update", {
			task_id: h.id,
			next_action: "Run configuration check",
		});
		const state = h.store.getState();
		h.store.replay(h.ctx.sessionManager.getBranch());
		const restored = await h.call("task_resume");
		expect(text(restored)).toContain("pi-tasks resume");
		expect(restored.details).toEqual(buildTaskResume(state));
		const result = await h.call("task_update", {
			task_id: h.id,
			next_action: "Continue configuration check",
		});
		expect(text(result)).toContain("pi-tasks resume");
		expect(text(await h.call("task_focus"))).toContain("Expected output:");
		await h.call("task_checkpoint", { reason: "handoff" });
		const snapshot = h.store.getState().events.at(-1);
		assert.ok(snapshot?.type === "task.snapshot");
		h.store.append(
			{ ...snapshot, id: `${snapshot.id}-compaction`, reason: "compaction" },
			() => {},
		);
		const afterCheckpoint = await h.call("task_update", {
			task_id: h.id,
			next_action: "Resume configuration check",
		});
		expect(text(afterCheckpoint)).toContain("pi-tasks resume");
	});

	it("retains rejection recovery and failed checks without changing persistence", async () => {
		const h = await plannedHarness();
		const before = h.store.getState();
		const rejected = await h.call("task_update", {
			task_id: h.id,
			step_id: `${h.id}-S1`,
			step_status: "done",
		});
		expect(rejected.isError).toBe(true);
		expect(text(rejected)).toContain("Recovery:");
		expect(text(rejected)).toContain("do_not_retry_same_call: true");
		expect(text(rejected)).toContain("Recovery guidance:\npi-tasks resume");
		expect(h.store.getState()).toBe(before);
		const failed = await h.call("task_evidence", {
			task_id: h.id,
			step_ids: [`${h.id}-S1`],
			criterion_ids: [`${h.id}-AC1`],
			...proof,
			passed: "false",
			summary: "Configuration check failed",
		});
		expect(failed.isError).not.toBe(true);
		expect(text(failed)).toContain("New failed checks:");
		expect(text(failed)).toContain("Configuration check failed");
		const history = await h.call("task_list", { include_history: true });
		expect(text(history)).toContain("Configuration check failed");
		expect(text(history)).toContain('"passed": false');
	});

	it("compacts idempotent evidence retries without appending events", async () => {
		const h = await plannedHarness();
		const params = { task_id: h.id, ...proof, passed: "true" };
		await h.call("task_evidence", params);
		const state = h.store.getState();
		const duplicate = await h.call("task_evidence", params);
		expect(text(duplicate)).toContain("Evidence already recorded");
		expect(text(duplicate)).not.toContain("pi-tasks resume");
		expect(h.store.getState()).toBe(state);
		const stepParams = { task_id: h.id, step_id: `${h.id}-S1`, ...proof };
		await h.call("task_verify_step", stepParams);
		const verifiedState = h.store.getState();
		const retried = await h.call("task_verify_step", stepParams);
		expect(text(retried)).toContain("retry made no changes");
		expect(text(retried)).not.toContain("pi-tasks resume");
		expect(h.store.getState()).toBe(verifiedState);
	});

	it("exposes a failed check even on first success after replay", async () => {
		const h = await plannedHarness();
		h.store.replay(h.ctx.sessionManager.getBranch());
		const result = await h.call("task_evidence", {
			task_id: h.id,
			...proof,
			passed: "false",
			summary: "Fresh failed check",
		});
		expect(result.isError).not.toBe(true);
		expect(text(result)).toContain("pi-tasks resume");
		expect(text(result)).toContain("Failed check:");
		expect(text(result)).toContain("Fresh failed check");
	});

	it("keeps a new blocker visible and stops execution with the existing gate", async () => {
		const h = await plannedHarness();
		const result = await h.call("task_update", {
			task_id: h.id,
			status: "blocked",
			blocker: {
				reason: "Fixture service unavailable",
				blockedBy: "external",
				neededToUnblock: "Restore fixture service",
			},
		});
		expect(result.isError).not.toBe(true);
		expect(text(result)).toContain("New blockers:");
		expect(text(result)).toContain("Fixture service unavailable");
		expect(text(result)).toContain(`Affected task: ${h.id} [blocked]`);
		expect(h.store.getState().activeTaskId).toBeUndefined();
		expect(result.details).toEqual(buildTaskResume(h.store.getState()));
		expect((result.details as TaskResumeContext).blockedTools).toContain(
			"task_complete",
		);
	});

	it.each([false, true])(
		"preserves the real execution contract when activate=false (other active=%s)",
		async (otherActive) => {
			const h = otherActive ? await plannedHarness() : harness();
			const activeId = h.store.getState().activeTaskId;
			const created = await h.call("task_plan", {
				...plan,
				title: "Inactive fixture",
				activate: false,
			});
			expect(created.isError).not.toBe(true);
			const id = Object.keys(h.store.getState().tasks).at(-1);
			assert.ok(id);
			expect(text(created)).toContain(`Affected task: ${id} [pending]`);
			expect(h.store.getState().activeTaskId).toBe(activeId);
			expect(created.details).toEqual(buildTaskResume(h.store.getState()));
			const updated = await h.call("task_update", {
				task_id: id,
				next_action: "Pending configuration work",
			});
			expect(text(updated)).toContain(`Affected task: ${id} [pending]`);
			expect(text(updated)).not.toContain(`Current step: ${id}-S1`);
			expect(updated.details).toEqual(buildTaskResume(h.store.getState()));
			const blocked = await h.call("task_update", {
				task_id: id,
				blocker: {
					reason: "Inactive service unavailable",
					blockedBy: "external",
					neededToUnblock: "Restore inactive service",
				},
			});
			expect(blocked.isError).not.toBe(true);
			expect(text(blocked)).toContain(`Affected task: ${id} [pending]`);
			expect(text(blocked)).toContain("Inactive service unavailable");
			expect(blocked.details).toEqual(buildTaskResume(h.store.getState()));
			expect(h.store.getState().activeTaskId).toBe(activeId);
		},
	);

	it("reports a nonactive review task blocker while preserving another active contract", async () => {
		const h = await plannedHarness();
		await h.call("task_update", { task_id: h.id, status: "review" });
		const other = await h.call("task_plan", {
			...plan,
			title: "Other active fixture",
		});
		expect(other.isError).not.toBe(true);
		const activeId = h.store.getState().activeTaskId;
		assert.ok(activeId && activeId !== h.id);
		const blocked = await h.call("task_update", {
			task_id: h.id,
			status: "blocked",
			blocker: {
				reason: "Review fixture unavailable",
				blockedBy: "external",
				neededToUnblock: "Restore review fixture",
			},
		});
		expect(blocked.isError).not.toBe(true);
		expect(text(blocked)).toContain(`Affected task: ${h.id} [blocked]`);
		expect(text(blocked)).toContain("Review fixture unavailable");
		expect(text(blocked)).toContain(`Current step: ${activeId}-S1`);
		expect(blocked.details).toEqual(buildTaskResume(h.store.getState()));
		expect(h.store.getState().activeTaskId).toBe(activeId);
	});

	it.each(["done", "cancelled"])(
		"reports %s without advertising execution of the terminal target",
		async (status) => {
			const h = await plannedHarness();
			if (status === "done") {
				for (let i = 1; i <= 3; i++) {
					const result = await h.call("task_verify_step", {
						task_id: h.id,
						step_id: `${h.id}-S${i}`,
						...proof,
						summary: `Configuration ${i} passed`,
					});
					expect(result.isError).not.toBe(true);
				}
			}
			const task = h.store.getState().tasks[h.id];
			assert.ok(task);
			const result =
				status === "done"
					? await h.call("task_complete", {
							task_id: h.id,
							summary: "Configuration fixture complete",
							evidence_ids: task.evidence.map((item) => item.id),
						})
					: await h.call("task_update", {
							task_id: h.id,
							status,
							reason: "Fixture objective withdrawn",
						});
			expect(result.isError).not.toBe(true);
			expect(text(result)).toContain(`Affected task: ${h.id} [${status}]`);
			expect(text(result)).not.toContain("Do now: task_complete");
			expect(h.store.getState().activeTaskId).toBeUndefined();
			expect(result.details).toEqual(buildTaskResume(h.store.getState()));
		},
	);

	it("diffs full constraint lists before display caps, including newly relevant tail entries", async () => {
		const h = await plannedHarness();
		const before = structuredClone(h.store.getState());
		const priorTask = before.tasks[h.id];
		assert.ok(priorTask);
		const criterion = priorTask.acceptanceCriteria[0];
		assert.ok(criterion);
		for (let i = 0; i < 10; i++) {
			priorTask.acceptanceCriteria.push({
				...criterion,
				id: `C${i}`,
				text: `Criterion ${i}`,
			});
			priorTask.blockers.push({
				id: `B${i}`,
				reason: `Blocker ${i}`,
				blockedBy: "external",
				neededToUnblock: `Resolve ${i}`,
				createdAt: priorTask.createdAt,
			});
			priorTask.warnings.push(`Warning ${i}`);
		}
		const after = structuredClone(before);
		const task = after.tasks[h.id];
		assert.ok(task);
		task.acceptanceCriteria.push({
			...criterion,
			id: "TAIL",
			text: "New tail criterion",
		});
		const blocker = task.blockers[0];
		assert.ok(blocker);
		task.blockers.push({
			...blocker,
			id: "TAIL-B",
			reason: "New tail blocker",
		});
		task.warnings.push("New tail warning");
		const receipt = formatTaskReceipt(after, before);
		expect(receipt).toContain("TAIL pending");
		expect(receipt).toContain("TAIL-B: New tail blocker");
		expect(receipt).toContain("New tail warning");
		expect(priorTask.blockers).toHaveLength(10);
		expect(task.blockers).toHaveLength(11);
	});

	it("reports omitted new constraints and leaves all of them available in retained state", async () => {
		const h = await plannedHarness();
		const before = h.store.getState();
		const after = structuredClone(before);
		const task = after.tasks[h.id];
		assert.ok(task);
		for (let i = 0; i < 12; i++) task.warnings.push(`New warning ${i}`);
		const receipt = formatTaskReceipt(after, before);
		expect(receipt).toContain(
			"7 more; task_list({ include_history: true }) for full details",
		);
		expect(task.warnings).toHaveLength(12);
		expect(receipt).not.toContain("New warning 11");
	});

	it("benchmarks a sanitized multi-step session against baseline full success rendering", async () => {
		const h = await plannedHarness();
		let baselineChars = 0;
		let receiptChars = 0;
		const record = (result: Awaited<ReturnType<typeof h.call>>) => {
			expect(result.isError).not.toBe(true);
			const output = text(result);
			const prefix = output.split("\n\n")[0];
			assert.ok(prefix);
			const state = h.store.getState();
			const baseline = `${prefix}\n\n${formatTaskResume(state)}`;
			baselineChars += baseline.length;
			receiptChars += output.length;
			expect(result.details).toEqual(buildTaskResume(state));
		};
		for (let i = 1; i <= 3; i++) {
			record(
				await h.call("task_update", {
					task_id: h.id,
					next_action: `Run configuration check ${i}`,
				}),
			);
			record(
				await h.call("task_verify_step", {
					task_id: h.id,
					step_id: `${h.id}-S${i}`,
					...proof,
					summary: `Configuration ${i} passed`,
					references: [`fixture-${i}.log`],
				}),
			);
		}
		const resume = await h.call("task_resume");
		expect((resume.details as TaskResumeContext).recommendedTool).toBe(
			"task_complete",
		);
		expect(resume.details).toEqual(buildTaskResume(h.store.getState()));
		console.log(
			JSON.stringify({
				workload: "six routine success calls, three-step sanitized fixture",
				baselineChars,
				receiptChars,
				reductionPercent: Math.round((1 - receiptChars / baselineChars) * 100),
				modelTimeAttribution: "unknown",
			}),
		);
		// Leave room for shared contract guidance while requiring meaningful savings.
		expect(receiptChars).toBeLessThanOrEqual(baselineChars * 0.8);
	});
});
