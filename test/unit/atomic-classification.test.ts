import { describe, expect, it, vi } from "vitest";
import { TASK_EVENT_CUSTOM_TYPE, type TaskEvent } from "../../src/model.ts";
import { buildTaskResume } from "../../src/render.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";

const created: TaskEvent = {
	version: 1,
	id: "create",
	taskId: "T1",
	createdAt: "2026-09-26T00:00:00Z",
	source: "tool",
	type: "task.created",
	title: "Atomic classification",
	objective: "Preserve a simple deliverable",
	activate: true,
	acceptanceCriteria: ["Configuration regression passes"],
	planSteps: [
		{
			text: "Validate backend configuration",
			expectedOutput: "Configuration regression report",
			allowedActions: ["bash"],
		},
	],
};
const classification: TaskEvent = {
	...created,
	type: "task.updated",
	id: "classify",
	stepId: "T1-S1",
	stepGranularityCheck: {
		isAtomic: true,
		reason: "One configuration regression produces one report",
		canBeDoneInOneAgentAction: true,
		hasSingleObservableOutput: true,
		hasSingleVerificationMethod: true,
		hasNoHiddenSubtasks: true,
	},
};

function setup() {
	const store = createTaskRuntimeStore();
	store.append(created, () => {});
	return store;
}

describe("current-step atomic classification", () => {
	it("rejects an existing later step without mutation", () => {
		const store = createTaskRuntimeStore();
		store.append(
			{
				...created,
				planSteps: [...(created.planSteps ?? []), ...(created.planSteps ?? [])],
			},
			() => {},
		);
		const before = structuredClone(store.getState());
		const persist = vi.fn();
		expect(() =>
			store.append({ ...classification, stepId: "T1-S2" }, persist),
		).toThrow("current open step_id");
		expect(store.getState()).toEqual(before);
		expect(persist).not.toHaveBeenCalled();
	});

	it.each([
		"task.created",
		"task.replanned",
		"task.reworked",
		"task.steps_decomposed",
	] as const)(
		"rejects compound atomic authorship via %s while preserving legacy replay",
		(type) => {
			const step = {
				text: "Validate backend configuration and refresh cache",
				expectedOutput: "Configuration regression report",
				allowedActions: ["bash"],
				decompositionStatus: "atomic" as const,
				granularityCheck: classification.stepGranularityCheck,
			};
			const store = setup();
			const event: TaskEvent =
				type === "task.created"
					? { ...created, id: "compound", planSteps: [step] }
					: type === "task.steps_decomposed"
						? {
								...created,
								id: "compound",
								type,
								parentStepId: "T1-S1",
								reason: "Compound check",
								childSteps: [step, step],
							}
						: type === "task.replanned"
							? {
									...created,
									id: "compound",
									type,
									stepIds: ["T1-S1"],
									reason: "Compound check",
									planSteps: [step],
								}
							: {
									...created,
									id: "compound",
									type,
									reason: "Compound check",
									planSteps: [step],
								};
			const before = structuredClone(store.getState());
			const persist = vi.fn();
			expect(() => store.append(event, persist)).toThrow("compound wording");
			expect(store.getState()).toEqual(before);
			expect(persist).not.toHaveBeenCalled();
			const legacy = createTaskRuntimeStore();
			legacy.replay([
				{
					type: "custom",
					customType: TASK_EVENT_CUSTOM_TYPE,
					data: { ...created, planSteps: [step] },
				},
			]);
			expect(legacy.getState().warnings).toEqual([]);
			expect(
				legacy.getState().tasks.T1?.planSteps[0]?.decompositionStatus,
			).toBe("atomic");
		},
	);
	it("preserves identity and evidence obligations across replay without inventing children", () => {
		const store = setup();
		const before = structuredClone(store.getState().tasks.T1);
		store.append(classification, () => {});
		const task = store.getState().tasks.T1;
		expect(task?.planSteps).toHaveLength(1);
		expect(task?.planSteps[0]).toMatchObject({
			id: "T1-S1",
			decompositionStatus: "atomic",
			evidenceRequired: true,
			childStepIds: [],
			evidenceIds: [],
			criterionIds: ["T1-AC1"],
		});
		expect(task?.acceptanceCriteria).toEqual(before?.acceptanceCriteria);
		expect(buildTaskResume(store.getState()).recommendedTool).toBe(
			"task_verify_step",
		);
		expect(() =>
			store.append(
				{
					...classification,
					id: "done",
					stepGranularityCheck: undefined,
					stepStatus: "done",
				},
				() => {},
			),
		).toThrow();
		const restored = createTaskRuntimeStore();
		restored.replay(
			store.getState().events.map((data) => ({
				type: "custom",
				customType: TASK_EVENT_CUSTOM_TYPE,
				data,
			})),
		);
		expect(restored.getState()).toEqual(store.getState());
	});

	it.each([
		{ stepId: "T1-S2" },
		{ stepId: undefined },
		{ stepStatus: "done" as const },
		{ status: "done" as const },
		{
			stepGranularityCheck: {
				...classification.stepGranularityCheck,
				hasNoHiddenSubtasks: false,
			},
		},
		{
			stepGranularityCheck: {
				...classification.stepGranularityCheck,
				reason: "",
			},
		},
	])("rejects invalid classification atomically: %j", (patch) => {
		const store = setup();
		const before = structuredClone(store.getState());
		const persist = vi.fn();
		expect(() =>
			store.append({ ...classification, ...patch }, persist),
		).toThrow();
		expect(store.getState()).toEqual(before);
		expect(persist).not.toHaveBeenCalled();
	});

	it("rejects compound work even with all atomicity flags true", () => {
		const store = createTaskRuntimeStore();
		store.append(
			{
				...created,
				planSteps: [
					{
						text: "Validate backend configuration and refresh cache",
						expectedOutput: "Configuration regression report",
						allowedActions: ["bash"],
					},
				],
			},
			() => {},
		);
		expect(() => store.append(classification, () => {})).toThrow(
			"compound wording",
		);
	});

	it("rejects classification of an inactive blocked task without resolving blockers", () => {
		const store = setup();
		store.append(
			{
				...created,
				type: "task.updated",
				id: "block",
				status: "blocked",
				blocker: {
					reason: "Owner decision pending",
					blockedBy: "user",
					neededToUnblock: "Owner answer",
				},
			},
			() => {},
		);
		const before = structuredClone(store.getState().tasks.T1);
		expect(() => store.append(classification, () => {})).toThrow("active task");
		expect(store.getState().tasks.T1).toEqual(before);
	});
});
