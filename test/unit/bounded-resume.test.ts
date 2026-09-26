import { describe, expect, it } from "vitest";
import type { TaskEvent } from "../../src/model.ts";
import {
	buildTaskResume,
	formatTaskFocus,
	formatTaskNext,
	formatTaskResume,
	getVerificationGaps,
} from "../../src/render.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";

const created: TaskEvent = {
	version: 1,
	id: "create",
	taskId: "T1",
	createdAt: "2026-09-26T00:00:00Z",
	source: "tool",
	type: "task.created",
	title: "Bounded task context",
	objective: "Retain full state outside routine results",
	activate: true,
	acceptanceCriteria: ["Renderer preserves actionable state"],
	planSteps: [
		{
			text: "Validate task context",
			expectedOutput: "Bounded resume report",
			allowedActions: ["bash"],
		},
	],
};

describe("bounded routine task context", () => {
	it("bounds text and structured history while preserving the execution decision and raw state", () => {
		const store = createTaskRuntimeStore();
		store.append(created, () => {});
		const state = structuredClone(store.getState());
		const task = state.tasks.T1;
		if (!task?.planSteps[0]) throw new Error("Expected task step");
		const step = task.planSteps[0];
		task.planSteps = Array.from({ length: 500 }, (_, i) => ({
			...structuredClone(step),
			id: `T1-S${i + 1}`,
		}));
		task.warnings = Array.from(
			{ length: 500 },
			(_, i) => `decomposed T1-S${i}: historical decomposition`,
		);
		task.warnings.unshift("scope_change: unresolved approval needed");
		const before = structuredClone(state);
		const resume = buildTaskResume(state);
		expect(resume.currentStepId).toBe("T1-S1");
		expect(resume.recommendedTool).toBe("task_decompose");
		expect(resume.blockedTools).toContain("task_complete");
		expect(resume.verificationGaps).toHaveLength(6);
		expect(resume.warnings).toHaveLength(4);
		expect(resume.warnings[0]).toContain("scope_change:");
		expect(resume.warnings[1]).toContain("T1-S499:");
		expect(resume.warnings.at(-1)).toContain("498 more");
		expect(JSON.stringify(resume).length).toBeLessThan(5000);
		for (const format of [formatTaskResume, formatTaskFocus, formatTaskNext]) {
			const text = format(state);
			expect(text.length).toBeLessThan(5000);
			expect(text).toContain("include_history: true");
		}
		expect(getVerificationGaps(task).length).toBeGreaterThan(500);
		expect(state).toEqual(before);
	});

	it("keeps blocked execution even when the blocker list is summarized", () => {
		const store = createTaskRuntimeStore();
		store.append(created, () => {});
		for (let i = 0; i < 10; i++)
			store.append(
				{
					...created,
					type: "task.updated",
					id: `block-${i}`,
					blocker: {
						reason: `Approval ${i}`,
						blockedBy: "user",
						neededToUnblock: "Owner answer",
					},
				},
				() => {},
			);
		const resume = buildTaskResume(store.getState());
		expect(resume.mode).toBe("blocked");
		expect(resume.blockers).toHaveLength(4);
		expect(resume.blockers.at(-1)).toContain("7 more");
		expect(store.getState().tasks.T1?.blockers).toHaveLength(10);
	});
});
