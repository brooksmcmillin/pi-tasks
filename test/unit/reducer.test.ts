import { describe, expect, it } from "vitest";
import {
	createEmptyState,
	type TaskEvent,
	type TaskState,
} from "../../src/model.ts";
import {
	reduceTaskState,
	replayTaskEvents,
	TaskTransitionError,
} from "../../src/reducer.ts";
import { formatTaskList } from "../../src/render.ts";

const now = "2026-06-18T00:00:00.000Z";

const atomicCheck = {
	isAtomic: true,
	reason: "Single reducer edit with one unit-test verification",
	canBeDoneInOneAgentAction: true,
	hasSingleObservableOutput: true,
	hasSingleVerificationMethod: true,
	hasNoHiddenSubtasks: true,
};

function created(taskId = "T1", activate = true): TaskEvent {
	return {
		version: 1,
		id: `${taskId}-created`,
		type: "task.created",
		taskId,
		createdAt: now,
		source: "tool",
		title: "Build MVP",
		objective: "Implement pi-tasks MVP",
		acceptanceCriteria: ["model exists", "completion requires evidence"],
		planSteps: [
			{
				text: "write reducer",
				expectedOutput: "Reducer transition is implemented",
				criterionIds: [`${taskId}-AC1`, `${taskId}-AC2`],
				evidenceRequired: true,
				allowedActions: ["edit reducer", "run unit test"],
				decompositionStatus: "atomic",
				granularityCheck: atomicCheck,
			},
		],
		activate,
	};
}

function coarseCreated(): TaskEvent {
	return {
		...created(),
		planSteps: [
			{
				text: "Prepare release verification package",
				expectedOutput:
					"Release verification package produces auditable output",
				criterionIds: ["T1-AC1", "T1-AC2"],
				evidenceRequired: true,
				allowedActions: ["inspect", "edit", "test"],
				granularityCheck: {
					isAtomic: false,
					reason: "Contains build, package, install, and dogfood subtasks",
					canBeDoneInOneAgentAction: false,
					hasSingleObservableOutput: false,
					hasSingleVerificationMethod: false,
					hasNoHiddenSubtasks: false,
				},
			},
		],
	};
}

function updated(
	fields: Partial<Extract<TaskEvent, { type: "task.updated" }>>,
): TaskEvent {
	return {
		version: 1,
		id: `T1-updated-${Math.random()}`,
		type: "task.updated",
		taskId: "T1",
		createdAt: now,
		source: "tool",
		...fields,
	};
}

function evidence(
	params: Partial<Extract<TaskEvent, { type: "task.evidence_added" }>> = {},
): Extract<TaskEvent, { type: "task.evidence_added" }> {
	return {
		version: 1,
		id: "T1-evidence",
		type: "task.evidence_added",
		taskId: "T1",
		createdAt: now,
		source: "tool",
		evidence: {
			id: "E1",
			type: "test",
			level: "unit_test",
			summary: "vitest passed",
			passed: true,
			references: ["npm test"],
			quality: {
				source: "vitest",
				reproducible: true,
				verifier: "tool",
				artifactRefs: ["npm test"],
				observedOutput: "Test suite passed",
			},
		},
		criterionIds: ["T1-AC1", "T1-AC2"],
		...params,
	};
}

function complete(
	params: Partial<Extract<TaskEvent, { type: "task.completed" }>> = {},
): TaskEvent {
	return {
		version: 1,
		id: "T1-complete",
		type: "task.completed",
		taskId: "T1",
		createdAt: now,
		source: "tool",
		summary: "done",
		evidenceIds: ["E1"],
		...params,
	};
}

function stepDone(stepId = "T1-S1"): TaskEvent {
	return updated({ stepId, stepStatus: "done" });
}

function evidenceThenStepDone(): TaskEvent[] {
	return [evidence(), stepDone()];
}

function decompose(): TaskEvent {
	return {
		version: 1,
		id: "T1-decompose",
		type: "task.steps_decomposed",
		taskId: "T1",
		createdAt: now,
		source: "tool",
		parentStepId: "T1-S1",
		reason: "Split release workflow into atomic verification steps",
		childSteps: [
			{
				text: "Run package dry-run",
				expectedOutput: "npm pack dry-run completes",
				criterionIds: ["T1-AC1"],
				evidenceRequired: true,
				allowedActions: ["npm pack --dry-run"],
				decompositionStatus: "atomic",
				granularityCheck: atomicCheck,
			},
			{
				text: "Run installed package smoke",
				expectedOutput: "Installed package smoke completes",
				criterionIds: ["T1-AC2"],
				evidenceRequired: true,
				allowedActions: ["pi installed smoke"],
				decompositionStatus: "atomic",
				granularityCheck: atomicCheck,
			},
		],
	};
}

function apply(events: TaskEvent[]): TaskState {
	return replayTaskEvents(events);
}

describe("task reducer", () => {
	it("creates and activates a task", () => {
		const state = reduceTaskState(createEmptyState(), created());
		expect(state.activeTaskId).toBe("T1");
		expect(state.tasks.T1.status).toBe("active");
		expect(state.tasks.T1.planSteps[0]?.id).toBe("T1-S1");
		expect(state.tasks.T1.planSteps[0]?.status).toBe("active");
		expect(state.tasks.T1.acceptanceCriteria).toHaveLength(2);
	});

	it("rejects task creation without ordered plan steps", () => {
		expect(() =>
			reduceTaskState(createEmptyState(), {
				...created(),
				planSteps: [],
			}),
		).toThrow("At least one ordered plan step is required");
	});

	it("requires non-atomic steps to be decomposed before completion", () => {
		expect(() => apply([coarseCreated(), evidence(), stepDone()])).toThrow(
			"use task_decompose until it is atomic",
		);
		const state = apply([coarseCreated(), decompose()]);
		expect(state.tasks.T1.planSteps.map((step) => step.id)).toEqual([
			"T1-S1.1",
			"T1-S1.2",
		]);
		expect(state.tasks.T1.planSteps[0]?.status).toBe("active");
		expect(state.tasks.T1.planSteps[0]?.parentStepId).toBe("T1-S1");
		expect(state.tasks.T1.currentStep).toBe("Run package dry-run");
	});

	it("rejects compound atomic step wording", () => {
		expect(() =>
			apply([
				{
					...created(),
					planSteps: [
						{
							text: "Run tests and update docs",
							expectedOutput: "Test result is recorded",
							criterionIds: ["T1-AC1"],
							evidenceRequired: true,
							allowedActions: ["npm test"],
							decompositionStatus: "atomic",
							granularityCheck: atomicCheck,
						},
					],
				},
			]),
		).toThrow("multiple actions");
	});

	it("does not auto-link criterion evidence to multiple matching child steps", () => {
		const sharedCriterionDecompose: TaskEvent = {
			...decompose(),
			childSteps: [
				{
					text: "Run package dry-run",
					expectedOutput: "npm pack dry-run completes",
					criterionIds: ["T1-AC1"],
					evidenceRequired: true,
					allowedActions: ["npm pack --dry-run"],
					decompositionStatus: "atomic",
					granularityCheck: atomicCheck,
				},
				{
					text: "Run package import smoke",
					expectedOutput: "package import smoke completes",
					criterionIds: ["T1-AC1"],
					evidenceRequired: true,
					allowedActions: ["node import smoke"],
					decompositionStatus: "atomic",
					granularityCheck: atomicCheck,
				},
			],
		};
		const broadEvidence: TaskEvent = {
			...evidence(),
			criterionIds: ["T1-AC1"],
		};
		const stepEvidence: TaskEvent = {
			...evidence({
				id: "T1-evidence-step",
				evidence: {
					id: "E2",
					type: "test",
					level: "unit_test",
					summary: "pack dry-run passed",
					passed: true,
					references: ["npm pack --dry-run"],
					quality: {
						source: "npm",
						reproducible: true,
						verifier: "tool",
						artifactRefs: ["npm pack --dry-run"],
						observedOutput: "npm pack dry-run completed",
					},
				},
			}),
			criterionIds: ["T1-AC1"],
			stepIds: ["T1-S1.1"],
		};
		const broadState = apply([
			coarseCreated(),
			sharedCriterionDecompose,
			broadEvidence,
		]);
		expect(broadState.tasks.T1.planSteps[0]?.evidenceIds).toEqual([]);
		expect(broadState.tasks.T1.planSteps[1]?.evidenceIds).toEqual([]);
		const linkedState = apply([
			coarseCreated(),
			sharedCriterionDecompose,
			stepEvidence,
		]);
		expect(linkedState.tasks.T1.planSteps[0]?.evidenceIds).toEqual(["E2"]);
		expect(linkedState.tasks.T1.planSteps[1]?.evidenceIds).toEqual([]);
	});

	it("keeps only one active task by default", () => {
		const state = apply([created("T1", true), created("T2", true)]);
		expect(state.activeTaskId).toBe("T2");
		expect(state.tasks.T1.status).toBe("pending");
		expect(state.tasks.T2.status).toBe("active");
	});

	it("clamps update progress to 0-100", () => {
		const state = apply([created(), updated({ progress: 130 })]);
		expect(state.tasks.T1.progress).toBe(100);
	});

	it("blocks and unblocks a task", () => {
		const state = apply([
			created(),
			updated({
				status: "blocked",
				blocker: {
					reason: "Need user choice",
					blockedBy: "user",
					neededToUnblock: "Choose option",
				},
			}),
			updated({ status: "active", reason: "User chose option" }),
		]);
		expect(state.tasks.T1.status).toBe("active");
		expect(state.tasks.T1.blockers[0]?.resolvedAt).toBe(now);
	});

	it("rejects blocked transition without blocker details", () => {
		expect(() => apply([created(), updated({ status: "blocked" })])).toThrow(
			TaskTransitionError,
		);
	});

	it("adds evidence and satisfies criteria with passing evidence", () => {
		const state = apply([created(), evidence()]);
		expect(state.tasks.T1.evidence).toHaveLength(1);
		expect(state.tasks.T1.evidence[0]?.role).toBe("acceptance");
		expect(
			state.tasks.T1.acceptanceCriteria.every(
				(criterion) => criterion.status === "satisfied",
			),
		).toBe(true);
		// Regression guard for the progress-inflation bug: satisfying
		// acceptance criteria and adding evidence must not pull progress up
		// while the task's single deliverable plan step remains open.
		expect(state.tasks.T1.planSteps[0]?.status).not.toBe("done");
		expect(state.tasks.T1.progress).toBe(1);
		expect(state.tasks.T1.progress).toBeLessThan(100);
	});

	it("deduplicates identical evidence during replay", () => {
		const state = apply([
			created(),
			evidence(),
			evidence({
				id: "T1-evidence-duplicate",
				evidence: {
					id: "E2",
					type: "test",
					level: "unit_test",
					summary: "vitest passed",
					passed: true,
					references: ["npm test"],
					quality: {
						source: "vitest",
						reproducible: true,
						verifier: "tool",
						artifactRefs: ["npm test"],
						observedOutput: "Test suite passed",
					},
				},
			}),
		]);
		expect(state.tasks.T1.evidence).toHaveLength(1);
		expect(state.tasks.T1.evidence[0]?.id).toBe("E1");
		expect(state.tasks.T1.acceptanceCriteria[0]?.evidenceIds).toEqual(["E1"]);
	});

	it("advances plan steps only in order", () => {
		const state = apply([created(), ...evidenceThenStepDone()]);
		expect(state.tasks.T1.planSteps[0]?.status).toBe("done");
		expect(state.tasks.T1.currentStep).toBeUndefined();
		expect(state.tasks.T1.progress).toBeGreaterThan(1);
		expect(() =>
			apply([
				created(),
				evidence(),
				updated({ stepId: "T1-S2", stepStatus: "done" }),
			]),
		).toThrow("cannot be updated before T1-S1");
	});

	it("rejects evidence-required step completion without evidence", () => {
		expect(() => apply([created(), stepDone()])).toThrow(
			"requires evidence before done",
		);
	});

	it("records scope drift warnings when activity is off plan", () => {
		const state = apply([
			created(),
			updated({
				activity: "Edited an unrelated release script",
				scope: "off_plan",
				scopeReason: "Needed to verify drift detection",
			}),
		]);
		expect(state.tasks.T1.warnings[0]).toContain("off_plan");
		expect(() =>
			apply([
				created(),
				updated({ activity: "Changed scope", scope: "scope_change" }),
			]),
		).toThrow("requires scopeReason");
	});

	it("requires scope drift warnings to be resolved before completion", () => {
		const warning =
			"off_plan: Edited an unrelated release script (Needed to verify drift detection)";
		expect(() =>
			apply([
				created(),
				updated({
					activity: "Edited an unrelated release script",
					scope: "off_plan",
					scopeReason: "Needed to verify drift detection",
				}),
				...evidenceThenStepDone(),
				complete(),
			]),
		).toThrow("unresolved scope drift warning");
		const state = apply([
			created(),
			updated({
				activity: "Edited an unrelated release script",
				scope: "off_plan",
				scopeReason: "Needed to verify drift detection",
			}),
			...evidenceThenStepDone(),
			updated({ resolveWarnings: [warning] }),
			complete(),
		]);
		expect(state.tasks.T1.status).toBe("done");
	});

	it("derives high active progress when all criteria are satisfied", () => {
		const state = apply([created(), ...evidenceThenStepDone()]);
		expect(state.tasks.T1.status).toBe("active");
		expect(state.tasks.T1.progress).toBe(99);
	});

	it("rejects passing non-note evidence with not_verified level", () => {
		expect(() =>
			apply([
				created(),
				evidence({
					evidence: {
						id: "E1",
						type: "test",
						level: "not_verified",
						summary: "claimed pass",
						passed: true,
						references: [],
					},
				}),
			]),
		).toThrow(TaskTransitionError);
	});

	it("rejects low-quality evidence without observed output", () => {
		expect(() =>
			apply([
				created(),
				evidence({
					evidence: {
						id: "E1",
						type: "test",
						level: "unit_test",
						summary: "tests passed",
						passed: true,
						references: ["npm test"],
						quality: {
							source: "vitest",
							reproducible: true,
							verifier: "agent",
							artifactRefs: ["npm test"],
						},
					},
				}),
			]),
		).toThrow("observedOutput is required");
	});

	it("rejects oversized evidence text", () => {
		expect(() =>
			apply([
				created(),
				evidence({
					evidence: {
						id: "E1",
						type: "test",
						level: "unit_test",
						summary: "x".repeat(501),
						passed: true,
						references: ["npm test"],
						quality: {
							source: "vitest",
							reproducible: true,
							verifier: "tool",
							artifactRefs: ["npm test"],
							observedOutput: "Test suite passed",
						},
					},
				}),
			]),
		).toThrow("summary exceeds");
	});

	it("locks evidence to the current step unless overrideReason is provided", () => {
		expect(() =>
			apply([
				coarseCreated(),
				decompose(),
				evidence({
					stepIds: ["T1-S1.2"],
					criterionIds: ["T1-AC2"],
				}),
			]),
		).toThrow("current step T1-S1.1");

		const state = apply([
			coarseCreated(),
			decompose(),
			evidence({
				stepIds: ["T1-S1.2"],
				criterionIds: ["T1-AC2"],
				overrideReason: "Backfilling evidence from prior installed smoke",
			}),
		]);
		expect(state.tasks.T1.planSteps[1]?.evidenceIds).toEqual(["E1"]);
	});

	it("rejects completion without evidence", () => {
		expect(() => apply([created(), complete({ evidenceIds: [] })])).toThrow(
			TaskTransitionError,
		);
	});

	it("rejects task_update attempts to mark done without task_complete", () => {
		expect(() => apply([created(), updated({ status: "done" })])).toThrow(
			"Use task_complete",
		);
	});

	it("rejects completion with unresolved blocker", () => {
		expect(() =>
			apply([
				created(),
				...evidenceThenStepDone(),
				updated({
					status: "blocked",
					blocker: {
						reason: "External outage",
						blockedBy: "external",
						neededToUnblock: "Service returns",
					},
				}),
				complete(),
			]),
		).toThrow(TaskTransitionError);
	});

	it("completes with evidence", () => {
		const state = apply([created(), ...evidenceThenStepDone(), complete()]);
		expect(state.tasks.T1.status).toBe("done");
		expect(state.tasks.T1.progress).toBe(100);
		expect(state.activeTaskId).toBeUndefined();
	});

	it("retains diagnostic fail-first evidence without changing acceptance state", () => {
		const diagnosticEvidence = evidence({
			evidence: {
				...evidence().evidence,
				role: "diagnostic",
				passed: false,
				summary: "Fail-first test produced the expected failure",
			},
			criterionIds: ["T1-AC1", "T1-AC2"],
			stepIds: ["T1-S1"],
		});
		const diagnosticState = apply([created(), diagnosticEvidence]);
		expect(diagnosticState.tasks.T1.evidence).toHaveLength(1);
		expect(diagnosticState.tasks.T1.evidence[0]?.role).toBe("diagnostic");
		expect(
			diagnosticState.tasks.T1.acceptanceCriteria.every(
				(criterion) => criterion.status === "pending",
			),
		).toBe(true);
		expect(diagnosticState.tasks.T1.acceptanceCriteria[0]?.evidenceIds).toEqual(
			["E1"],
		);
		const diagnosticStepState = apply([
			created(),
			diagnosticEvidence,
			stepDone(),
		]);
		expect(diagnosticStepState.tasks.T1.planSteps[0]?.status).toBe("done");
		expect(
			diagnosticStepState.tasks.T1.acceptanceCriteria.every(
				(criterion) => criterion.status === "pending",
			),
		).toBe(true);

		const passingEvidence = evidence({
			evidence: {
				...evidence().evidence,
				id: "E2",
				summary: "Implementation test passed",
				passed: true,
			},
			criterionIds: ["T1-AC1", "T1-AC2"],
			stepIds: ["T1-S1"],
		});
		const state = apply([
			created(),
			diagnosticEvidence,
			passingEvidence,
			stepDone(),
			complete({ evidenceIds: ["E2"] }),
		]);
		expect(state.tasks.T1.status).toBe("done");
		expect(state.tasks.T1.evidence.map((item) => item.id)).toEqual([
			"E1",
			"E2",
		]);
		const output = formatTaskList(state, {
			includeDone: true,
			includeEvidence: true,
		});
		expect(output).toContain("E1 evidence unit_test false");
		expect(output).toContain("role:diagnostic");
	});

	it("rejects diagnostic evidence as completion evidence", () => {
		const diagnosticEvidence = evidence({
			evidence: {
				...evidence().evidence,
				role: "diagnostic",
				passed: true,
				summary: "Diagnostic probe passed",
			},
			criterionIds: ["T1-AC1", "T1-AC2"],
			stepIds: ["T1-S1"],
		});
		const acceptanceEvidence = evidence({
			evidence: {
				...evidence().evidence,
				id: "E2",
				summary: "Acceptance test passed",
			},
			criterionIds: [],
			stepIds: ["T1-S1"],
		});
		const readyEvents = [
			created(),
			diagnosticEvidence,
			acceptanceEvidence,
			stepDone(),
		];
		expect(() =>
			apply([...readyEvents, complete({ evidenceIds: ["E1"] })]),
		).toThrow("Completion requires active acceptance evidence");
		expect(() =>
			apply([
				...readyEvents,
				complete({
					evidenceIds: ["E2"],
					criterionResults: [
						{
							criterionId: "T1-AC1",
							status: "satisfied",
							evidenceIds: ["E1"],
						},
					],
				}),
			]),
		).toThrow(
			"Criterion T1-AC1 is satisfied without active acceptance evidence",
		);
	});

	it("requires explicit passing supersession before linked failing evidence stops blocking completion", () => {
		const failedEvidence = evidence({
			evidence: {
				id: "E1",
				type: "test",
				level: "unit_test",
				summary: "Initial test run failed formatting",
				passed: false,
				references: ["npm test"],
				quality: {
					source: "vitest",
					reproducible: true,
					verifier: "tool",
					artifactRefs: ["npm test"],
					observedOutput: "Formatting check failed",
				},
			},
			criterionIds: [],
			stepIds: ["T1-S1"],
		});
		const passingEvidence = evidence({
			evidence: {
				id: "E2",
				type: "test",
				level: "unit_test",
				summary: "Test rerun passed after formatting",
				passed: true,
				references: ["npm test"],
				quality: {
					source: "vitest",
					reproducible: true,
					verifier: "tool",
					artifactRefs: ["npm test"],
					observedOutput: "Test suite passed",
				},
			},
			criterionIds: ["T1-AC1", "T1-AC2"],
			stepIds: ["T1-S1"],
		});
		const unsupersededEvents = [
			created(),
			failedEvidence,
			passingEvidence,
			stepDone(),
		];
		expect(() =>
			apply([...unsupersededEvents, complete({ evidenceIds: ["E2"] })]),
		).toThrow("Plan step T1-S1 has failing evidence E1");

		const supersedingEvidence = {
			...passingEvidence,
			evidence: {
				...passingEvidence.evidence,
				supersedesEvidenceIds: ["E1"],
				supersessionReason: "Passing rerun after formatting",
			},
		} satisfies TaskEvent;
		const state = apply([
			created(),
			failedEvidence,
			supersedingEvidence,
			stepDone(),
			complete({ evidenceIds: ["E2"] }),
		]);
		expect(state.tasks.T1.status).toBe("done");
		expect(state.tasks.T1.evidence.map((item) => item.id)).toEqual([
			"E1",
			"E2",
		]);
		expect(state.tasks.T1.evidence[1]?.supersedesEvidenceIds).toEqual(["E1"]);
		expect(state.tasks.T1.evidence[1]?.supersessionReason).toBe(
			"Passing rerun after formatting",
		);
		const output = formatTaskList(state, {
			includeDone: true,
			includeEvidence: true,
		});
		expect(output).toContain("E1 evidence unit_test false");
		expect(output).toContain("superseded by:E2");
		expect(output).toContain("E2 evidence unit_test true");
		expect(output).toContain("supersedes:E1");
	});

	it("requires a reason and a passing replacement for supersession", () => {
		const failedEvidence = evidence({
			evidence: {
				...evidence().evidence,
				passed: false,
				summary: "Initial test run failed",
			},
			stepIds: ["T1-S1"],
		});
		const replacement = evidence({
			evidence: {
				...evidence().evidence,
				id: "E2",
				summary: "Test rerun passed",
				supersedesEvidenceIds: ["E1"],
				supersessionReason: "Passing rerun",
			},
			stepIds: ["T1-S1"],
		});

		expect(() =>
			apply([
				created(),
				failedEvidence,
				{
					...replacement,
					evidence: {
						...replacement.evidence,
						supersessionReason: "   ",
					},
				},
			]),
		).toThrow("Evidence supersession reason is required");
		expect(() =>
			apply([
				created(),
				failedEvidence,
				{
					...replacement,
					evidence: { ...replacement.evidence, passed: false },
				},
			]),
		).toThrow("Evidence supersession requires a passing replacement");
		expect(() =>
			apply([
				created(),
				failedEvidence,
				{
					...replacement,
					evidence: { ...replacement.evidence, role: "diagnostic" },
				},
			]),
		).toThrow("Evidence supersession requires an acceptance replacement");
	});

	it("rejects completion while plan steps remain open", () => {
		expect(() => apply([created(), evidence(), complete()])).toThrow(
			"Plan step T1-S1 is not complete",
		);
	});

	it("forced completion records warning and confidence below 80", () => {
		const state = apply([
			created(),
			complete({
				evidenceIds: [],
				forceWithReason: "External system unavailable",
			}),
		]);
		expect(state.tasks.T1.status).toBe("done");
		expect(state.tasks.T1.confidence).toBeLessThan(80);
		expect(state.tasks.T1.warnings[0]).toContain("Forced completion");
	});

	it("cancels task with reason", () => {
		const state = apply([
			created(),
			{
				version: 1,
				id: "T1-cancel",
				type: "task.cancelled",
				taskId: "T1",
				createdAt: now,
				source: "tool",
				reason: "Out of scope",
			},
		]);
		expect(state.tasks.T1.status).toBe("cancelled");
		expect(state.tasks.T1.cancelledAt).toBe(now);
	});

	it("replay reconstructs the same state", () => {
		const events = [created(), ...evidenceThenStepDone(), complete()];
		expect(replayTaskEvents(events)).toEqual(apply(events));
	});

	describe("deliverable-sized plans and support-action mechanics", () => {
		it("rejects decomposing into a pure read/instruction-load mechanic step instead of admitting it as a support action", () => {
			// This is the retro incident's shape: an agent tries to gain
			// permission to read mandatory workflow instructions by modeling
			// the read itself as a nested plan step. That must be rejected -
			// reads are always-admissible support actions, not plan steps.
			expect(() =>
				apply([
					coarseCreated(),
					{
						...decompose(),
						childSteps: [
							{
								text: "Read the mandatory workflow instructions",
								expectedOutput: "Instructions are read",
								criterionIds: ["T1-AC1"],
								evidenceRequired: true,
								allowedActions: ["read"],
								decompositionStatus: "atomic",
								granularityCheck: atomicCheck,
							},
							{
								text: "Run package dry-run",
								expectedOutput: "npm pack dry-run completes",
								criterionIds: ["T1-AC2"],
								evidenceRequired: true,
								allowedActions: ["npm pack --dry-run"],
								decompositionStatus: "atomic",
								granularityCheck: atomicCheck,
							},
						],
					},
				]),
			).toThrow(/read\/instruction-load mechanic/);
		});

		it("rejects decomposing into a pure commit mechanic step", () => {
			expect(() =>
				apply([
					coarseCreated(),
					{
						...decompose(),
						childSteps: [
							{
								text: "Create commit for release changes",
								expectedOutput: "Commit is created",
								criterionIds: ["T1-AC1"],
								evidenceRequired: true,
								allowedActions: ["git commit"],
								decompositionStatus: "atomic",
								granularityCheck: atomicCheck,
							},
							{
								text: "Run package dry-run",
								expectedOutput: "npm pack dry-run completes",
								criterionIds: ["T1-AC2"],
								evidenceRequired: true,
								allowedActions: ["npm pack --dry-run"],
								decompositionStatus: "atomic",
								granularityCheck: atomicCheck,
							},
						],
					},
				]),
			).toThrow(/commit mechanic/);
		});

		it("rejects a mechanic-only step at task creation, not only at decomposition", () => {
			expect(() =>
				apply([
					{
						...created(),
						planSteps: [
							{
								text: "Read the deployment runbook",
								expectedOutput: "Runbook is read",
								criterionIds: ["T1-AC1", "T1-AC2"],
								evidenceRequired: true,
								allowedActions: ["read"],
								decompositionStatus: "atomic",
								granularityCheck: atomicCheck,
							},
						],
					},
				]),
			).toThrow(/read\/instruction-load mechanic/);
		});

		it("caps derived progress by open deliverable plan steps, not by satisfied criteria or evidence alone", () => {
			// Regression for the progress-inflation bug: a plan with three
			// deliverable steps, only one of which is closed, but with all
			// acceptance criteria satisfied and evidence recorded. Under the
			// old equally-weighted average of (stepRatio, criteriaRatio, 1),
			// this would compute to round(((1/3) + 1 + 1) / 3 * 99) = 77 - and
			// with more criteria/evidence terms this climbs toward the
			// retro's ~88% even though two of three deliverables are still
			// open. The fix caps progress at the plan-step closure ratio.
			const threeStepCreated: TaskEvent = {
				...created(),
				planSteps: [
					{
						text: "Ship the reducer change",
						expectedOutput: "Reducer change is merged",
						criterionIds: ["T1-AC1", "T1-AC2"],
						evidenceRequired: true,
						allowedActions: ["edit reducer"],
						decompositionStatus: "atomic",
						granularityCheck: atomicCheck,
					},
					{
						text: "Ship the render change",
						expectedOutput: "Render change is merged",
						criterionIds: ["T1-AC1", "T1-AC2"],
						evidenceRequired: true,
						allowedActions: ["edit render"],
						decompositionStatus: "atomic",
						granularityCheck: atomicCheck,
					},
					{
						text: "Open the pull request",
						expectedOutput: "Pull request is open for review",
						criterionIds: ["T1-AC1", "T1-AC2"],
						evidenceRequired: true,
						allowedActions: ["gh pr create"],
						decompositionStatus: "atomic",
						granularityCheck: atomicCheck,
					},
				],
			};
			const oldBuggyAverage = Math.round(((1 / 3 + 1 + 1) / 3) * 99);
			expect(oldBuggyAverage).toBeGreaterThanOrEqual(75);

			const afterFirstStep = apply([
				threeStepCreated,
				evidence({ stepIds: ["T1-S1"] }),
				stepDone("T1-S1"),
			]);
			expect(
				afterFirstStep.tasks.T1.acceptanceCriteria.every(
					(criterion) => criterion.status === "satisfied",
				),
			).toBe(true);
			expect(afterFirstStep.tasks.T1.evidence.length).toBeGreaterThan(0);
			expect(
				afterFirstStep.tasks.T1.planSteps.filter(
					(step) => step.status !== "done" && step.status !== "skipped",
				).length,
			).toBe(2);
			// Two of three deliverables remain open: progress must stay well
			// below completion and below the old buggy average, not approach it.
			expect(afterFirstStep.tasks.T1.progress).toBeLessThan(90);
			expect(afterFirstStep.tasks.T1.progress).toBeLessThan(oldBuggyAverage);
			expect(afterFirstStep.tasks.T1.progress).toBe(33);

			const afterAllSteps = apply([
				threeStepCreated,
				evidence({ stepIds: ["T1-S1"] }),
				stepDone("T1-S1"),
				evidence({
					id: "T1-evidence-2",
					evidence: {
						id: "E2",
						type: "test",
						level: "unit_test",
						summary: "second step verified",
						passed: true,
						references: ["npm test"],
						quality: {
							source: "vitest",
							reproducible: true,
							verifier: "tool",
							artifactRefs: ["npm test"],
							observedOutput: "Test suite passed",
						},
					},
					stepIds: ["T1-S2"],
				}),
				stepDone("T1-S2"),
				evidence({
					id: "T1-evidence-3",
					evidence: {
						id: "E3",
						type: "test",
						level: "unit_test",
						summary: "third step verified",
						passed: true,
						references: ["npm test"],
						quality: {
							source: "vitest",
							reproducible: true,
							verifier: "tool",
							artifactRefs: ["npm test"],
							observedOutput: "Test suite passed",
						},
					},
					stepIds: ["T1-S3"],
				}),
				stepDone("T1-S3"),
			]);
			// All deliverables closed: progress now approaches completion.
			expect(
				afterAllSteps.tasks.T1.planSteps.every(
					(step) => step.status === "done",
				),
			).toBe(true);
			expect(afterAllSteps.tasks.T1.progress).toBe(99);
		});
	});
});
