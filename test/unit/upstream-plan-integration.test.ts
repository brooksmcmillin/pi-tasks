import { describe, expect, it, vi } from "vitest";
import { TASK_EVENT_CUSTOM_TYPE, type TaskEvent } from "../../src/model.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";

const check = {
	isAtomic: true,
	reason: "One manifest output verified by a focused regression",
	canBeDoneInOneAgentAction: true,
	hasSingleObservableOutput: true,
	hasSingleVerificationMethod: true,
	hasNoHiddenSubtasks: true,
};
const step = {
	text: "Render checkpoint manifest",
	expectedOutput: "Checkpoint manifest written",
	allowedActions: ["render checkpoint manifest"],
	granularityCheck: check,
};
const event: Extract<TaskEvent, { type: "task.created" }> = {
	version: 1,
	id: "create",
	taskId: "T1",
	type: "task.created",
	createdAt: "2026-10-26T00:00:00Z",
	source: "tool",
	title: "Integration regression",
	objective: "Preserve planning contracts across upstream integration",
	acceptanceCriteria: ["Manifest exists", "Manifest is valid"],
	activate: true,
	planSteps: [step],
};

describe("upstream plan-quality integration", () => {
	it.each([
		{ evidenceRequired: false },
		{ allowedActions: [] },
		{ criterionRefs: [] },
		...Object.keys(check)
			.filter((key) => key !== "reason")
			.map((key) => ({
				granularityCheck: { ...check, [key]: false },
			})),
	])("rejects malformed atomic replay invariants: %j", (override) => {
		const store = createTaskRuntimeStore();
		store.replay([
			{
				type: "custom",
				customType: TASK_EVENT_CUSTOM_TYPE,
				data: {
					...event,
					planSteps: [{ ...step, decompositionStatus: "atomic", ...override }],
				},
			},
		]);
		expect(store.getState().warnings).toHaveLength(1);
		expect(store.getState().tasks.T1).toBeUndefined();
	});
	it("aggregates authoring failures without persistence or partial state", () => {
		const store = createTaskRuntimeStore();
		const before = structuredClone(store.getState());
		const persist = vi.fn();
		let message = "";
		try {
			store.append(
				{
					...event,
					planSteps: [
						{ ...step, text: "Fix checkpoint manifest" },
						{ ...step, expectedOutput: "Checkpoint and index written" },
						{ ...step, text: "Read src/reducer.ts" },
					],
				},
				persist,
			);
		} catch (error) {
			message = String(error);
		}
		expect(message).toContain("Plan step 1");
		expect(message).toContain('("Fix")');
		expect(message).toContain("Plan step 2");
		expect(message).toContain('("and")');
		expect(message).toContain("Plan step 3");
		expect(persist).not.toHaveBeenCalled();
		expect(store.getState()).toEqual(before);
	});

	it("preserves legacy atomic classification without admitting new low-quality classification", () => {
		const coarse: TaskEvent = {
			...event,
			planSteps: [
				{
					...step,
					text: "Fix checkpoint manifest",
					decompositionStatus: "needs_breakdown",
				},
			],
		};
		const classified: TaskEvent = {
			version: 1,
			id: "classify",
			taskId: "T1",
			type: "task.updated",
			createdAt: event.createdAt,
			source: "tool",
			stepId: "T1-S1",
			stepGranularityCheck: check,
		};
		const store = createTaskRuntimeStore();
		store.append(coarse, () => {});
		expect(() => store.append(classified, () => {})).toThrow('("Fix")');
		store.replay(
			[coarse, classified].map((data) => ({
				type: "custom",
				customType: TASK_EVENT_CUSTOM_TYPE,
				data,
			})),
		);
		expect(store.getState().warnings).toEqual([]);
		expect(store.getState().tasks.T1?.planSteps[0]?.decompositionStatus).toBe(
			"atomic",
		);
	});

	it("preserves selective refs beside legacy empty-ID linking", () => {
		const store = createTaskRuntimeStore();
		store.append(
			{
				...event,
				planSteps: [
					{ ...step, criterionRefs: [2] },
					{ ...step, criterionIds: [] },
				],
			},
			() => {},
		);
		expect(
			store.getState().tasks.T1?.planSteps.map((item) => item.criterionIds),
		).toEqual([["T1-AC2"], ["T1-AC1", "T1-AC2"]]);
	});

	it("replays legacy single-issue atomic plans but rejects new authorship", () => {
		const legacy = {
			...event,
			planSteps: [{ ...step, text: "Fix checkpoint manifest" }],
		};
		const store = createTaskRuntimeStore();
		store.replay([
			{ type: "custom", customType: TASK_EVENT_CUSTOM_TYPE, data: legacy },
		]);
		expect(store.getState().warnings).toEqual([]);
		expect(store.getState().tasks.T1?.planSteps[0]?.text).toBe(
			"Fix checkpoint manifest",
		);
		expect(() => createTaskRuntimeStore().append(legacy, () => {})).toThrow(
			'("Fix")',
		);
	});
});
