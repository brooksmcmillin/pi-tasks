import { describe, expect, it } from "vitest";
import {
	TASK_EVENT_CUSTOM_TYPE,
	type TaskEvent,
	type TaskState,
	type TaskStepInput,
} from "../../src/model.ts";
import { reduceTaskState, replayTaskEvents } from "../../src/reducer.ts";
import {
	buildTaskResume,
	formatTaskFocus,
	formatTaskNext,
	formatTaskResume,
} from "../../src/render.ts";
import { replayBranchEntries, snapshotState } from "../../src/store.ts";

const base = {
	version: 1,
	id: "event",
	taskId: "T1",
	createdAt: "2026-09-10T00:00:00Z",
	source: "tool",
} as const;
const step: TaskStepInput = {
	text: "Guard failed batch progress",
	expectedOutput: "Failed batch retains the previous cursor",
	allowedActions: ["edit"],
	evidenceRequired: true,
	decompositionStatus: "atomic",
	granularityCheck: {
		isAtomic: true,
		reason: "One cursor guard with one regression assertion",
		canBeDoneInOneAgentAction: true,
		hasSingleObservableOutput: true,
		hasSingleVerificationMethod: true,
		hasNoHiddenSubtasks: true,
	},
};
const create: TaskEvent = {
	...base,
	type: "task.created",
	title: "Replication read model",
	objective: "Safe replicated reads",
	acceptanceCriteria: ["Progress is safe", "Freshness is visible"],
	planSteps: [step],
	activate: true,
};
const proof = (id: string) => ({
	id,
	type: "review" as const,
	level: "static_read" as const,
	summary: `Observed cursor regression passing in review ${id}`,
	passed: true,
	references: [`review-${id}.md`],
	quality: {
		source: "review",
		reproducible: true,
		verifier: "agent" as const,
		artifactRefs: [`review-${id}.md`],
	},
});
const verify: TaskEvent = {
	...base,
	type: "task.step_verified",
	stepId: "T1-S1",
	evidence: proof("E1"),
};
const rework: Extract<TaskEvent, { type: "task.reworked" }> = {
	...base,
	type: "task.reworked",
	reason: "Final review found progress advancing past a failed record",
	planSteps: [{ ...step, criterionIds: ["T1-AC1"] }],
};
const complete: TaskEvent = {
	...base,
	type: "task.completed",
	summary: "Replicated reads verified",
	evidenceIds: ["E1"],
};
function exhausted(): TaskState {
	return replayTaskEvents([create, verify]);
}

function assertGuidance(state: TaskState, tool: string) {
	const resume = buildTaskResume(state);
	expect(resume.recommendedTool).toBe(tool);
	expect(resume.nextAllowedActions).toContain(tool);
	expect(resume.nextAllowedActions).toContain("task_rework");
	expect(resume.nextAllowedActions).toContain("task_decision");
	expect(resume.blockedTools).not.toContain(tool);
	for (const format of [formatTaskNext, formatTaskFocus, formatTaskResume]) {
		expect(format(state)).toContain("task_rework");
	}
}

describe("task.reworked", () => {
	it("appends focused remediation without changing prior steps, evidence, or unrelated criteria", () => {
		const before = exhausted();
		const after = reduceTaskState(before, rework);
		const old = before.tasks.T1;
		const task = after.tasks.T1;
		if (!old || !task) throw new Error("Missing test task");
		expect(task.planSteps[0]).toEqual(old.planSteps[0]);
		expect(task.evidence).toEqual(old.evidence);
		expect(task.acceptanceCriteria[0]).toMatchObject({
			status: "pending",
			evidenceIds: ["E1"],
			evidenceBaseline: 1,
		});
		expect(task.acceptanceCriteria[1]).toEqual(old.acceptanceCriteria[1]);
		expect(task.planSteps[1]).toMatchObject({
			id: "T1-S2",
			status: "active",
			evidenceIds: [],
		});
		expect(task.currentStep).toBe(step.text);
		expect(task.confidence).toBe(0);
		expect(task.progress).toBeLessThan(old.progress);
		expect(after.events.slice(0, -1)).toEqual(before.events);
		expect(after.events.at(-1)).toEqual(rework);
		expect(task.warnings.at(-1)).toContain(rework.reason);
		expect(before).toEqual(exhausted());
		expect(() => reduceTaskState(after, complete)).toThrow(/not complete/);
		assertGuidance(after, "task_verify_step");
	});

	it("reopens done and review tasks explicitly; leaves cancellation terminal", () => {
		for (const event of [
			complete,
			{ ...base, type: "task.updated", status: "review" } as TaskEvent,
		]) {
			const before = reduceTaskState(exhausted(), event);
			expect(before.activeTaskId).toBeUndefined();
			expect(formatTaskResume(before)).toContain("task_rework");
			const after = reduceTaskState(before, rework);
			expect(after.activeTaskId).toBe("T1");
			expect(after.tasks.T1).toMatchObject({ status: "active", confidence: 0 });
			expect(after.tasks.T1?.completedAt).toBeUndefined();
			expect(after.tasks.T1?.completionSummary).toBeUndefined();
			expect(after.events).toContainEqual(event);
		}
		const cancelled = reduceTaskState(exhausted(), {
			...base,
			type: "task.cancelled",
			reason: "Not needed",
		});
		expect(() => reduceTaskState(cancelled, rework)).toThrow(/Cancelled tasks/);
	});

	it("requires fresh acceptance proof even when old evidence is relinked or criterion_results supplied", () => {
		let state = reduceTaskState(exhausted(), rework);
		state = reduceTaskState(state, {
			...base,
			type: "task.evidence_added",
			evidence: proof("E2"),
			criterionIds: ["T1-AC1"],
			stepIds: ["T1-S2"],
		});
		state = reduceTaskState(state, {
			...base,
			type: "task.updated",
			stepId: "T1-S2",
			stepStatus: "done",
		});
		state = reduceTaskState(state, rework);
		state = reduceTaskState(state, {
			...base,
			type: "task.evidence_added",
			evidence: proof("E1"),
			criterionIds: ["T1-AC1"],
			stepIds: ["T1-S3"],
		});
		expect(state.tasks.T1?.acceptanceCriteria[0]?.status).toBe("pending");
		state = reduceTaskState(state, {
			...base,
			type: "task.updated",
			stepId: "T1-S3",
			stepStatus: "done",
		});
		expect(() =>
			reduceTaskState(state, {
				...complete,
				criterionResults: [
					{ criterionId: "T1-AC1", status: "satisfied", evidenceIds: ["E1"] },
				],
			}),
		).toThrow(/after rework/);
		state = reduceTaskState(state, {
			...base,
			type: "task.evidence_added",
			evidence: { ...proof("E3"), role: "diagnostic" },
			criterionIds: ["T1-AC1"],
		});
		expect(state.tasks.T1?.acceptanceCriteria[0]?.status).toBe("pending");
		state = reduceTaskState(state, {
			...base,
			type: "task.evidence_added",
			evidence: proof("E4"),
			criterionIds: ["T1-AC1"],
		});
		expect(
			reduceTaskState(state, { ...complete, evidenceIds: ["E4"] }).tasks.T1
				?.status,
		).toBe("done");
	});

	it("rejects evidence ID reuse after rework instead of confusing old and fresh proof", () => {
		const state = reduceTaskState(exhausted(), rework);
		expect(() =>
			reduceTaskState(state, {
				...base,
				type: "task.evidence_added",
				evidence: {
					...proof("E1"),
					summary: "Observed a distinct rework verification result",
				},
				criterionIds: ["T1-AC1"],
			}),
		).toThrow(/Evidence ID E1 already exists/);
		expect(state.tasks.T1?.evidence).toHaveLength(1);
	});

	it("retains failed acceptance evidence until explicitly superseded", () => {
		let state = reduceTaskState(exhausted(), {
			...base,
			type: "task.evidence_added",
			evidence: { ...proof("FAIL"), passed: false },
			criterionIds: ["T1-AC1"],
			stepIds: ["T1-S1"],
		});
		state = reduceTaskState(state, rework);
		state = reduceTaskState(state, {
			...verify,
			stepId: "T1-S2",
			evidence: proof("E2"),
			criterionIds: ["T1-AC1"],
		});
		expect(() => reduceTaskState(state, complete)).toThrow(
			/failing evidence FAIL/,
		);
		state = reduceTaskState(state, {
			...base,
			type: "task.evidence_added",
			evidence: {
				...proof("E3"),
				supersedesEvidenceIds: ["FAIL"],
				supersessionReason: "Passing cursor guard regression after remediation",
			},
			criterionIds: ["T1-AC1"],
		});
		expect(reduceTaskState(state, complete).tasks.T1?.status).toBe("done");
		expect(state.tasks.T1?.evidence.map((item) => item.id)).toContain("FAIL");
	});

	it("preserves blockers, scope warnings, and decisions without approving or unblocking them", () => {
		let state = exhausted();
		state = reduceTaskState(state, {
			...base,
			type: "task.decision_recorded",
			decision: {
				id: "D1",
				question: "Choose cutover design?",
				decision: "Wait for historical copy",
				decidedBy: "user",
			},
		});
		state = reduceTaskState(state, {
			...base,
			type: "task.updated",
			scope: "scope_change",
			activity: "Assess cutover design",
			scopeReason: "Cutover design decision pending",
			status: "blocked",
			blocker: {
				reason: "Approval pending",
				blockedBy: "user",
				neededToUnblock: "User selects cutover design",
			},
		});
		const before = structuredClone(state.tasks.T1);
		state = reduceTaskState(state, {
			...rework,
			planSteps: [{ ...step, decompositionStatus: "needs_breakdown" }],
		});
		expect(formatTaskFocus(state)).not.toContain(
			"Next allowed action: task_decompose",
		);
		expect(buildTaskResume(state).blockedTools).toContain("task_decompose");
		expect(state.tasks.T1?.status).toBe("blocked");
		expect(state.tasks.T1?.blockers).toEqual(before?.blockers);
		expect(state.tasks.T1?.decisions).toEqual(before?.decisions);
		expect(state.tasks.T1?.warnings).toEqual(
			expect.arrayContaining(before?.warnings ?? []),
		);
		assertGuidance(state, "task_update");
		expect(() => reduceTaskState(state, complete)).toThrow();
	});

	it("does not displace a competing active task", () => {
		const state = reduceTaskState(exhausted(), { ...create, taskId: "T2" });
		expect(() => reduceTaskState(state, rework)).toThrow(/another active task/);
		expect(state.activeTaskId).toBe("T2");
	});

	it("keeps the current step ordered and allocates root IDs after decomposed descendants", () => {
		let state = replayTaskEvents([create]);
		state = reduceTaskState(state, {
			...base,
			type: "task.steps_decomposed",
			parentStepId: "T1-S1",
			reason: "Split cursor handling",
			childSteps: [step, step],
		});
		state = reduceTaskState(state, rework);
		expect(state.tasks.T1?.planSteps.map((item) => item.id)).toEqual([
			"T1-S1.1",
			"T1-S1.2",
			"T1-S2",
		]);
		expect(buildTaskResume(state).currentStepId).toBe("T1-S1.1");
		expect(
			state.tasks.T1?.planSteps.filter((item) => item.status === "active"),
		).toHaveLength(1);
	});

	it.each([
		{ reason: " " },
		{ reason: false },
		{ planSteps: [] },
		{ planSteps: null },
		{ planSteps: "step" },
		{ taskId: "unknown" },
		{ planSteps: [null] },
		{ planSteps: [{ ...step, criterionIds: ["unknown"] }] },
		{ planSteps: [{ ...step, criterionIds: [] }] },
		{ planSteps: [{ ...step, criterionIds: "T1-AC1" }] },
		{ planSteps: [{ ...step, text: 1 }] },
		{ planSteps: [{ ...step, evidenceRequired: false }] },
		{ planSteps: [{ ...step, allowedActions: "edit" }] },
		{ planSteps: [{ ...step, decompositionStatus: "bogus" }] },
		{
			planSteps: [
				{
					...step,
					granularityCheck: { ...step.granularityCheck, isAtomic: "false" },
				},
			],
		},
		{ planSteps: [{ ...step, text: "Run tests and update cursor" }] },
	])("rejects malformed rework without mutating state: %j", (fields) => {
		const state = exhausted();
		expect(() =>
			reduceTaskState(state, { ...rework, ...fields } as TaskEvent),
		).toThrow();
		expect(state).toEqual(exhausted());
	});

	it("replays persisted rework and snapshot-only branches with the same freshness gate", () => {
		const events = [create, verify, complete, rework];
		const entries = events.map((data) => ({
			type: "custom",
			customType: TASK_EVENT_CUSTOM_TYPE,
			data: JSON.parse(JSON.stringify(data)),
		}));
		const replayed = replayBranchEntries(entries);
		expect(replayed.malformedEvents).toEqual([]);
		expect(replayed.state).toEqual(replayTaskEvents(events));
		const snapshot: TaskEvent = {
			...base,
			type: "task.snapshot",
			state: snapshotState(replayed.state),
			resume: buildTaskResume(replayed.state),
			reason: "compaction",
		};
		const restored = replayTaskEvents([JSON.parse(JSON.stringify(snapshot))]);
		expect(restored.tasks).toEqual(replayed.state.tasks);
		expect(restored.tasks.T1?.acceptanceCriteria[0]?.evidenceBaseline).toBe(1);
		expect(buildTaskResume(restored)).toEqual(buildTaskResume(replayed.state));
		const originalBranch = replayBranchEntries(entries.slice(0, -1));
		expect(originalBranch.state.tasks.T1?.status).toBe("done");
	});
});

describe("exhausted-plan rework guidance", () => {
	it("permits completion or explicit review remediation when verification is satisfied", () => {
		assertGuidance(exhausted(), "task_complete");
	});
	it("permits evidence, not completion, when no step is open but verification is missing", () => {
		const state = exhausted();
		const criterion = state.tasks.T1?.acceptanceCriteria[0];
		if (!criterion) throw new Error("Missing test criterion");
		criterion.status = "pending";
		assertGuidance(state, "task_evidence");
		expect(buildTaskResume(state).nextAllowedActions).not.toContain(
			"task_complete",
		);
		expect(buildTaskResume(state).minimumParams).toMatchObject({
			step_ids: [],
			criterion_ids: ["T1-AC1"],
		});
	});
	it("permits blocker resolution, not completion, without an open step", () => {
		const state = exhausted();
		const task = state.tasks.T1;
		if (!task) throw new Error("Missing test task");
		task.status = "blocked";
		assertGuidance(state, "task_update");
		expect(buildTaskResume(state).nextAllowedActions).not.toContain(
			"task_complete",
		);
		expect(buildTaskResume(state).minimumParams).toMatchObject({
			status: "active",
		});
	});
});
