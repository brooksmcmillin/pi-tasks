import { describe, expect, it } from "vitest";
import { TASK_EVENT_CUSTOM_TYPE, type TaskEvent } from "../../src/model.ts";
import { buildTaskResume, getVerificationGaps } from "../../src/render.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";

const base = {
	version: 1 as const,
	taskId: "T1",
	createdAt: "2026-09-25T00:00:00Z",
	source: "tool" as const,
};
const events: TaskEvent[] = [
	{
		...base,
		id: "create",
		type: "task.created",
		title: "Legacy publication plan",
		objective: "Preserve replacement verification",
		acceptanceCriteria: ["Replacement regression passes"],
		activate: true,
		planSteps: [
			{
				text: "Validate obsolete publication",
				expectedOutput: "Publication regression report",
				allowedActions: ["bash"],
			},
		],
	},
	{
		...base,
		id: "skip",
		type: "task.updated",
		stepId: "T1-S1",
		stepStatus: "skipped",
		reason: "Superseded by corrected-tree verification",
	},
];

function replay() {
	const store = createTaskRuntimeStore();
	store.replay(
		events.map((data) => ({
			type: "custom",
			customType: TASK_EVENT_CUSTOM_TYPE,
			data,
		})),
	);
	return store;
}

describe("legacy skipped-step compatibility", () => {
	it("does not demand execution evidence for a reasoned skip after replay", () => {
		const store = replay();
		const task = store.getState().tasks.T1;
		if (!task) throw new Error("Expected legacy task");
		expect(task.planSteps[0]?.supersededBy).toBeUndefined();
		expect(getVerificationGaps(task)).not.toContain("T1-S1 lacks evidence");
		expect(getVerificationGaps(task)).toContain("T1-AC1 pending");
		expect(() =>
			store.append(
				{
					...base,
					id: "premature",
					type: "task.completed",
					summary: "No verification yet",
					evidenceIds: [],
				},
				() => {},
			),
		).toThrow();
		store.append(
			{
				...base,
				id: "proof",
				type: "task.evidence_added",
				criterionIds: ["T1-AC1"],
				evidence: {
					id: "E1",
					type: "test",
					level: "unit_test",
					summary: "Replacement regression passed",
					passed: true,
					references: ["test/replacement.test.ts"],
					quality: {
						source: "vitest",
						reproducible: true,
						verifier: "tool",
						command: "npm test",
						artifactRefs: ["test/replacement.test.ts"],
						observedOutput: "Replacement regression passed",
					},
				},
			},
			() => {},
		);
		expect(buildTaskResume(store.getState()).recommendedTool).toBe(
			"task_complete",
		);
		store.append(
			{
				...base,
				id: "complete",
				type: "task.completed",
				summary: "Replacement verified",
				evidenceIds: ["E1"],
			},
			() => {},
		);
		expect(store.getState().tasks.T1?.status).toBe("done");
	});

	it("still reports missing proof for completed steps", () => {
		const store = replay();
		const task = structuredClone(store.getState().tasks.T1);
		if (!task?.planSteps[0]) throw new Error("Expected legacy step");
		task.planSteps[0].status = "done";
		expect(getVerificationGaps(task)).toContain("T1-S1 lacks evidence");
	});
});
