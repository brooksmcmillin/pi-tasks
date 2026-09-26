import { describe, expect, it, vi } from "vitest";
import {
	TASK_EVENT_CUSTOM_TYPE,
	type TaskEvent,
	type TaskStepInput,
} from "../../src/model.ts";
import { buildTaskResume, getVerificationGaps } from "../../src/render.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";

const step: TaskStepInput = {
	text: "Validate backend configuration",
	expectedOutput: "Configuration regression passes",
	allowedActions: ["bash"],
};
const created: TaskEvent = {
	version: 1,
	id: "create",
	type: "task.created",
	taskId: "T1",
	createdAt: "2026-09-26T00:00:00Z",
	source: "tool",
	title: "Backend configuration",
	objective: "Align the token setting",
	acceptanceCriteria: ["Token loads from environment"],
	planSteps: [step],
	activate: true,
};

const repair: TaskEvent = {
	...created,
	id: "repair",
	type: "task.replanned",
	reason: "Replace mistaken inspection",
	stepIds: ["T1-S1"],
	planSteps: [step],
};

describe("explicit plan repair", () => {
	it("inserts replacements at the earliest target regardless of target order", () => {
		const store = createTaskRuntimeStore();
		store.append({ ...created, planSteps: [step, step, step, step] }, () => {});
		store.append({ ...repair, stepIds: ["T1-S4", "T1-S2"] }, () => {});
		expect(store.getState().tasks.T1?.planSteps.map((item) => item.id)).toEqual(
			["T1-S1", "T1-S5", "T1-S2", "T1-S3", "T1-S4"],
		);
		expect(buildTaskResume(store.getState()).currentStepId).toBe("T1-S1");
	});
	it("retains history and moves the lock to the replacement without inflating progress", () => {
		const store = createTaskRuntimeStore();
		store.append(created, () => {});
		const original = structuredClone(store.getState().tasks.T1?.planSteps[0]);
		store.append(repair, () => {});
		const task = store.getState().tasks.T1;
		if (!task) throw new Error("Expected repaired task");
		expect(task.planSteps.map((item) => item.id)).toEqual(["T1-S2", "T1-S1"]);
		expect(task.planSteps[1]).toEqual({
			...original,
			status: "skipped",
			supersededBy: ["T1-S2"],
		});
		expect(task.progress).toBe(1);
		expect(task.acceptanceCriteria[0]?.status).toBe("pending");
		expect(buildTaskResume(store.getState()).currentStepId).toBe("T1-S2");
		expect(getVerificationGaps(task)).not.toContain("T1-S1 lacks evidence");
		const replay = createTaskRuntimeStore();
		replay.replay(
			store.getState().events.map((data) => ({
				type: "custom",
				customType: TASK_EVENT_CUSTOM_TYPE,
				data,
			})),
		);
		expect(replay.getState()).toEqual(store.getState());
	});

	it.each([
		{ stepIds: [] },
		{ stepIds: ["T1-S1", "T1-S1"] },
		{ stepIds: ["missing"] },
		{ planSteps: [] },
		{ reason: " " },
		{ planSteps: [{ ...step, evidenceRequired: false }] },
	])("rejects invalid repairs atomically: %j", (patch) => {
		const store = createTaskRuntimeStore();
		store.append(created, () => {});
		const before = structuredClone(store.getState());
		const persist = vi.fn();
		expect(() => store.append({ ...repair, ...patch }, persist)).toThrow();
		expect(persist).not.toHaveBeenCalled();
		expect(store.getState()).toEqual(before);
	});

	it("cannot discard criterion coverage or retire a closed step", () => {
		const store = createTaskRuntimeStore();
		store.append(
			{ ...created, acceptanceCriteria: ["Token loads", "Client uses token"] },
			() => {},
		);
		expect(() =>
			store.append(
				{ ...repair, planSteps: [{ ...step, criterionIds: ["T1-AC1"] }] },
				() => {},
			),
		).toThrow("cover all replaced criterion links");
		store.append(repair, () => {});
		expect(() => store.append(repair, () => {})).toThrow(
			"must be an open plan step",
		);
	});

	it("preserves blockers, decisions, evidence, and failure gates", () => {
		const store = createTaskRuntimeStore();
		store.append(created, () => {});
		store.append(
			{
				...created,
				id: "fail",
				type: "task.evidence_added",
				criterionIds: ["T1-AC1"],
				stepIds: ["T1-S1"],
				evidence: {
					id: "E1",
					type: "test",
					level: "unit_test",
					summary: "Token regression failed with empty credentials",
					passed: false,
					references: ["test/token.test.ts"],
					quality: {
						source: "vitest",
						reproducible: true,
						verifier: "tool",
						command: "npm test",
						artifactRefs: ["test/token.test.ts"],
						observedOutput: "Token regression failed: empty credentials",
					},
				},
			},
			() => {},
		);
		store.append(
			{
				...created,
				id: "decision",
				type: "task.decision_recorded",
				decision: {
					id: "D1",
					question: "Which setting?",
					decision: "Use deployed environment key",
					decidedBy: "user",
				},
			},
			() => {},
		);
		store.append(
			{
				...created,
				id: "block",
				type: "task.updated",
				status: "blocked",
				blocker: {
					reason: "Awaiting environment",
					blockedBy: "environment",
					neededToUnblock: "Restore environment",
				},
			},
			() => {},
		);
		const before = structuredClone(store.getState().tasks.T1);
		if (!before) throw new Error("Expected original task");
		store.append(repair, () => {});
		const after = store.getState().tasks.T1;
		if (!after) throw new Error("Expected repaired task");
		expect(after.status).toBe("blocked");
		expect(after.blockers).toEqual(before.blockers);
		expect(after.evidence).toEqual(before.evidence);
		expect(after.acceptanceCriteria).toEqual(before.acceptanceCriteria);
		expect(after.decisions).toEqual(before.decisions);
		expect(after.planSteps[1]?.evidenceIds).toEqual(["E1"]);
		expect(() =>
			store.append(
				{
					...created,
					id: "complete",
					type: "task.completed",
					summary: "Delivery complete",
					evidenceIds: ["E1"],
				},
				() => {},
			),
		).toThrow("blocked -> done");
		store.append(
			{
				...created,
				id: "unblock",
				type: "task.updated",
				status: "active",
				reason: "Environment restored",
			},
			() => {},
		);
		store.append(
			{
				...repair,
				id: "atomic-repair",
				stepIds: ["T1-S2"],
				planSteps: [
					{
						...step,
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "One regression command",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
				],
			},
			() => {},
		);
		store.append(
			{
				...created,
				id: "pass",
				type: "task.step_verified",
				stepId: "T1-S3",
				criterionIds: ["T1-AC1"],
				evidence: {
					id: "E2",
					type: "test",
					level: "unit_test",
					summary: "Replacement regression passed",
					passed: true,
					references: ["test/token.test.ts"],
					quality: {
						source: "vitest",
						reproducible: true,
						verifier: "tool",
						command: "npm test",
						artifactRefs: ["test/token.test.ts"],
						observedOutput: "Replacement regression passed: 1 test",
					},
				},
			},
			() => {},
		);
		expect(store.getState().tasks.T1?.planSteps[0]?.status).toBe("done");
		expect(() =>
			store.append(
				{
					...created,
					id: "complete-unblocked",
					type: "task.completed",
					summary: "Delivery complete",
					evidenceIds: ["E2"],
				},
				() => {},
			),
		).toThrow("failing evidence E1");
	});

	it("does not replace another active task or reopen cancellation", () => {
		const store = createTaskRuntimeStore();
		store.append(created, () => {});
		store.append({ ...created, id: "other", taskId: "T2" }, () => {});
		expect(() => store.append(repair, () => {})).toThrow(
			"Select the intended task",
		);
		store.append(
			{
				...created,
				id: "cancel",
				type: "task.updated",
				status: "cancelled",
				reason: "Operator cancelled",
			},
			() => {},
		);
		expect(() => store.append(repair, () => {})).toThrow("nonterminal");
	});
});

describe("plan authoring compatibility", () => {
	it.each(
		(
			[
				"task.created",
				"task.steps_decomposed",
				"task.reworked",
				"task.replanned",
			] as const
		).flatMap((type) =>
			[
				"Inspect backend Grafana configuration",
				"Inspect test configuration",
				"Inspect the backend Grafana configuration for production deployment",
			].map((text) => ({ type, text })),
		),
	)("rejects inspection mechanics in $type: $text", ({ type, text }) => {
		const store = createTaskRuntimeStore();
		if (type !== "task.created") store.append(created, () => {});
		const before = structuredClone(store.getState());
		const persist = vi.fn();
		const inspection = {
			...step,
			text,
		};
		const event: TaskEvent =
			type === "task.created"
				? { ...created, planSteps: [inspection] }
				: type === "task.reworked"
					? {
							...created,
							type,
							reason: "Wrong plan",
							planSteps: [inspection],
						}
					: type === "task.replanned"
						? {
								...created,
								type,
								reason: "Wrong plan",
								stepIds: ["T1-S1"],
								planSteps: [inspection],
							}
						: {
								...created,
								type,
								parentStepId: "T1-S1",
								reason: "Split plan",
								childSteps: [inspection, step],
							};
		expect(() => store.append(event, persist)).toThrow(
			"Perform the read outside the plan",
		);
		expect(persist).not.toHaveBeenCalled();
		expect(store.getState()).toEqual(before);
	});

	it("replays a legacy inspection plan so it can be repaired", () => {
		const store = createTaskRuntimeStore();
		const event = {
			...created,
			planSteps: [{ ...step, text: "Inspect backend Grafana configuration" }],
		};
		const result = store.replay([
			{ type: "custom", customType: TASK_EVENT_CUSTOM_TYPE, data: event },
		]);
		expect(result.malformedEvents).toEqual([]);
		expect(result.state.tasks.T1?.planSteps[0]?.text).toBe(
			"Inspect backend Grafana configuration",
		);
	});

	it("allows substantive inspection deliverables", () => {
		const store = createTaskRuntimeStore();
		expect(() =>
			store.append(
				{
					...created,
					planSteps: [
						{ ...step, text: "Inspect configuration to verify token binding" },
					],
				},
				() => {},
			),
		).not.toThrow();
	});
});
