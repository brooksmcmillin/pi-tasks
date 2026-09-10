import { describe, expect, it } from "vitest";
import { TASK_EVENT_CUSTOM_TYPE, type TaskEvent } from "../../src/model.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../../src/pi-types.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";
import { registerTaskTools } from "../../src/tools.ts";

class FixedIds {
	private index = 0;
	next(prefix: string): string {
		this.index += 1;
		return `${prefix}${this.index}`;
	}
}

type ReceiverBoundPi = ExtensionAPI & {
	runtime: {
		entries: TaskEvent[];
	};
};

function createHarness() {
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const entries: TaskEvent[] = [];
	const publications: string[] = [];
	const ui = {
		status: undefined as string | undefined,
		widget: undefined as string[] | undefined,
	};
	const pi: ReceiverBoundPi = {
		runtime: { entries },
		events: {
			emit: (name) => {
				publications.push(name);
			},
		},
		on: () => {},
		registerTool: (tool) => tools.set(tool.name, tool),
		registerCommand: () => {},
		appendEntry(customType, data) {
			expect(customType).toBe(TASK_EVENT_CUSTOM_TYPE);
			this.runtime.entries.push(data as TaskEvent);
		},
	};
	const ctx: ExtensionContext = {
		sessionManager: {
			getBranch: () =>
				entries.map((entry, index) => ({
					type: "custom",
					customType: TASK_EVENT_CUSTOM_TYPE,
					id: `entry-${index}`,
					data: entry,
				})),
		},
		ui: {
			notify: () => {},
			setStatus: (_key, text) => {
				ui.status = text;
			},
			setWidget: (_key, lines) => {
				ui.widget = lines;
			},
		},
	};
	const store = createTaskRuntimeStore();
	registerTaskTools(pi, store, new FixedIds());
	return { tools, entries, ctx, store, ui, publications, pi };
}

async function execute(
	tool: ToolDefinition<Record<string, unknown>>,
	params: Record<string, unknown>,
	ctx: ExtensionContext,
) {
	return tool.execute("call-1", params, undefined, undefined, ctx);
}

function requireTool(
	tools: Map<string, ToolDefinition<Record<string, unknown>>>,
	name: string,
): ToolDefinition<Record<string, unknown>> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`Tool ${name} not registered`);
	return tool;
}

describe("registered task tools", () => {
	it("registers evidence-preserving rework with discoverable guidance and persisted publication", async () => {
		const { tools, entries, ctx, store, ui, publications, pi } =
			createHarness();
		const rework = requireTool(tools, "task_rework");
		for (const name of [
			"task_next",
			"task_focus",
			"task_resume",
			"task_complete",
			"task_plan",
			"task_rework",
		]) {
			const tool = requireTool(tools, name);
			expect(tool.promptSnippet).toBeTruthy();
			expect(tool.promptGuidelines?.join(" ")).toContain("task_rework");
			expect(tool.description).toContain(
				"without asking permission for in-scope repairs",
			);
			expect(tool.description).toContain("task_decision");
			expect(tool.description).not.toContain("call only the recommended tool");
		}
		expect(rework.parameters.required).toEqual([
			"task_id",
			"reason",
			"plan_steps",
		]);
		const step = {
			text: "Guard failed batch progress",
			expectedOutput: "Failed batch retains previous cursor",
			allowedActions: ["edit"],
			evidenceRequired: true,
			decompositionStatus: "atomic",
			granularityCheck: {
				isAtomic: true,
				reason: "Single cursor guard",
				canBeDoneInOneAgentAction: true,
				hasSingleObservableOutput: true,
				hasSingleVerificationMethod: true,
				hasNoHiddenSubtasks: true,
			},
		};
		await execute(
			requireTool(tools, "task_plan"),
			{
				title: "Replica cursor",
				objective: "Preserve failed batch cursor",
				acceptance_criteria: ["Cursor remains safe"],
				plan_steps: [step],
			},
			ctx,
		);
		await execute(
			requireTool(tools, "task_verify_step"),
			{
				task_id: "T1",
				step_id: "T1-S1",
				type: "review",
				level: "static_read",
				summary: "Observed cursor guard in source",
				references: ["review.md"],
				quality: {
					source: "review",
					reproducible: true,
					verifier: "agent",
					artifactRefs: ["review.md"],
				},
			},
			ctx,
		);
		const oldEvidence = structuredClone(store.getState().tasks.T1?.evidence);
		const count = entries.length;
		const publicationCount = publications.length;
		const result = await execute(
			rework,
			{
				task_id: "T1",
				reason: "Review found batch progress regression",
				plan_steps: [step],
			},
			ctx,
		);
		expect(result.isError).not.toBe(true);
		expect(entries).toHaveLength(count + 1);
		expect(entries.at(-1)?.type).toBe("task.reworked");
		expect(publications.slice(publicationCount)).toContain("pi-tasks:state");
		expect(ui.widget?.join("\n")).toContain("T1-S2");
		expect(result.content[0]?.text).toContain("T1-S2");
		expect(store.getState().tasks.T1?.evidence).toEqual(oldEvidence);
		const restored = createTaskRuntimeStore();
		restored.replay(ctx.sessionManager.getBranch());
		expect(restored.getState()).toEqual(store.getState());
		const beforeRejection = structuredClone(store.getState());
		const priorPublications = [...publications];
		for (const params of [
			{ task_id: "T1", reason: " ", plan_steps: [step] },
			{ task_id: "T1", reason: "Review gaps", plan_steps: null },
			{ task_id: "missing", reason: "Review gaps", plan_steps: [step] },
		]) {
			const rejected = await execute(rework, params, ctx);
			expect(rejected.isError).toBe(true);
			expect(rejected.content[0]?.text).toContain("retry_with: task_rework");
		}
		expect(store.getState()).toEqual(beforeRejection);
		expect(entries).toHaveLength(count + 1);
		expect(publications).toEqual(priorPublications);
		registerTaskTools(pi, restored, new FixedIds());
		const fresh = await execute(
			requireTool(tools, "task_verify_step"),
			{
				task_id: "T1",
				step_id: "T1-S2",
				type: "review",
				level: "static_read",
				summary: "Observed passing cursor regression after rework",
				references: ["rework-review.md"],
				quality: {
					source: "review",
					reproducible: true,
					verifier: "agent",
					artifactRefs: ["rework-review.md"],
				},
			},
			ctx,
		);
		expect(fresh.isError).not.toBe(true);
		expect(
			restored.getState().tasks.T1?.evidence.map((item) => item.id),
		).toEqual(["E1", "E2"]);
		expect(restored.getState().tasks.T1?.acceptanceCriteria[0]?.status).toBe(
			"satisfied",
		);
	});

	it("projects prompt guidelines into tool descriptions for hosts that ignore custom fields", () => {
		const { tools } = createHarness();
		const plan = requireTool(tools, "task_plan");

		expect(plan.promptGuidelines).toContain(
			"Use task_plan for multi-step work before implementation when no suitable active task exists.",
		);
		expect(plan.description).toContain("Agent guidance:");
		expect(plan.description).toContain(
			"Use task_plan for multi-step work before implementation when no suitable active task exists.",
		);
	});

	it("uses an omp-compatible task_evidence schema with required quality fields", () => {
		const { tools } = createHarness();
		const evidence = requireTool(tools, "task_evidence");
		const schema = evidence.parameters as {
			type?: string;
			required?: string[];
			properties?: Record<
				string,
				{
					type?: string;
					enum?: string[];
					required?: string[];
					description?: string;
				}
			>;
		};

		expect(schema.type).toBe("object");
		expect(schema.required).toEqual(
			expect.arrayContaining([
				"task_id",
				"type",
				"level",
				"summary",
				"passed",
				"references",
				"quality",
			]),
		);
		expect(schema.properties?.type?.enum).toEqual(
			expect.arrayContaining(["command", "test", "dogfood", "review"]),
		);
		expect(schema.properties?.quality?.required).toEqual(
			expect.arrayContaining([
				"source",
				"reproducible",
				"verifier",
				"command",
				"artifactRefs",
				"observedOutput",
			]),
		);
		expect(schema.properties?.role?.enum).toEqual(["acceptance", "diagnostic"]);
		expect(schema.properties?.supersedes_evidence_ids?.type).toBe("array");
		expect(schema.properties?.reason?.description).toContain(
			"Required non-empty explanation",
		);
		expect(evidence.promptGuidelines).toContain(
			"For expected or remediated fail-first results, use role diagnostic; diagnostic evidence remains visible and may support diagnostic steps, but cannot satisfy criteria or task completion.",
		);
		expect(evidence.description).toContain("supersedes_evidence_ids");
		expect(schema).not.toHaveProperty("oneOf");
	});

	it("records explicit supersession metadata through task_evidence", async () => {
		const { tools, ctx, store } = createHarness();
		const plan = requireTool(tools, "task_plan");
		const evidence = requireTool(tools, "task_evidence");
		await execute(
			plan,
			{
				title: "Evidence supersession",
				objective: "Replace a linked failed verification with an explicit pass",
				acceptance_criteria: ["The verification passes"],
				plan_steps: [
					{
						text: "Run focused verification",
						expectedOutput: "Focused verification passes",
						evidenceRequired: true,
						allowedActions: ["task_evidence"],
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "Single verification command",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
				],
				activate: true,
			},
			ctx,
		);
		const quality = {
			source: "vitest",
			reproducible: true,
			verifier: "tool",
			command: "npm test",
			artifactRefs: ["npm test"],
			observedOutput: "Focused verification result",
		};
		await execute(
			evidence,
			{
				task_id: "T1",
				type: "test",
				level: "unit_test",
				summary: "Initial verification failed",
				passed: "false",
				references: ["npm test"],
				criterion_ids: ["T1-AC1"],
				step_ids: ["T1-S1"],
				quality,
			},
			ctx,
		);
		const replacement = await execute(
			evidence,
			{
				task_id: "T1",
				type: "test",
				level: "unit_test",
				summary: "Verification rerun passed",
				passed: "true",
				references: ["npm test"],
				criterion_ids: ["T1-AC1"],
				step_ids: ["T1-S1"],
				supersedes_evidence_ids: ["E1"],
				reason: "Passing rerun after formatting",
				quality,
			},
			ctx,
		);

		expect(replacement.isError).not.toBe(true);
		const diagnostic = await execute(
			evidence,
			{
				task_id: "T1",
				type: "test",
				role: "diagnostic",
				level: "unit_test",
				summary: "Fail-first probe produced the expected failure",
				passed: "false",
				references: ["npm test"],
				criterion_ids: ["T1-AC1"],
				step_ids: ["T1-S1"],
				quality,
			},
			ctx,
		);
		expect(diagnostic.isError).not.toBe(true);
		expect(store.getState().tasks.T1?.evidence).toHaveLength(3);
		expect(store.getState().tasks.T1?.evidence[0]?.role).toBe("acceptance");
		expect(store.getState().tasks.T1?.evidence[1]).toMatchObject({
			id: "E2",
			role: "acceptance",
			supersedesEvidenceIds: ["E1"],
			supersessionReason: "Passing rerun after formatting",
		});
		expect(store.getState().tasks.T1?.evidence[2]).toMatchObject({
			id: "E3",
			role: "diagnostic",
		});
	});

	it("requires traceable evidence for atomic step verification", () => {
		const { tools } = createHarness();
		const verify = requireTool(tools, "task_verify_step");
		const schema = verify.parameters as {
			required?: string[];
			properties?: Record<string, { required?: string[] }>;
		};

		expect(schema.required).toEqual(
			expect.arrayContaining(["references", "quality"]),
		);
		expect(schema.properties?.quality?.required).toEqual(
			expect.arrayContaining([
				"source",
				"reproducible",
				"verifier",
				"command",
				"artifactRefs",
				"observedOutput",
			]),
		);
	});

	it("returns a copyable task_evidence example after quality rejection", async () => {
		const { tools, ctx } = createHarness();
		const plan = requireTool(tools, "task_plan");
		const evidence = requireTool(tools, "task_evidence");

		await execute(
			plan,
			{
				title: "Evidence recovery",
				objective: "Verify task_evidence recovery example",
				acceptance_criteria: ["Recovery example is returned"],
				plan_steps: [
					{
						text: "Record command evidence",
						expectedOutput: "Rejected evidence includes a corrected example",
						criterionIds: ["T1-AC1"],
						evidenceRequired: true,
						allowedActions: ["task_evidence"],
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "Single evidence recording call",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
				],
				activate: true,
			},
			ctx,
		);

		const rejected = await execute(
			evidence,
			{
				task_id: "T1",
				type: "command",
				level: "e2e_smoke",
				summary: "npm test passed",
				passed: "true",
				references: ["npm test"],
				criterion_ids: ["T1-AC1"],
				step_ids: ["T1-S1"],
				quality: {
					source: "local shell",
					reproducible: true,
					verifier: "tool",
					artifactRefs: ["npm test"],
				},
			},
			ctx,
		);

		expect(rejected.isError).toBe(true);
		expect(rejected.content[0]?.text).toContain(
			"Minimal working task_evidence params",
		);
		expect(rejected.content[0]?.text).toContain('"command": "npm test"');
		expect(rejected.content[0]?.text).toContain(
			'"observedOutput": "<concise observed output',
		);
		expect(rejected.details).toMatchObject({
			rejected: true,
			retry_example: {
				task_id: "T1",
				type: "command",
				quality: {
					command: "npm test",
					observedOutput:
						"<concise observed output from the command/test/dogfood run>",
				},
			},
		});
	});

	it("preserves ExtensionAPI method receivers when appending task events", async () => {
		const { tools, ctx, store } = createHarness();
		const plan = requireTool(tools, "task_plan");
		const decision = requireTool(tools, "task_decision");

		const created = await execute(
			plan,
			{
				title: "Receiver compatibility",
				objective:
					"Verify task_plan works with receiver-bound ExtensionAPI methods",
				acceptance_criteria: ["Task event is appended through ExtensionAPI"],
				plan_steps: [
					{
						text: "Record receiver compatibility evidence",
						expectedOutput: "Receiver-bound appendEntry stores a task event",
						criterionIds: ["T1-AC1"],
						evidenceRequired: true,
						allowedActions: ["task_plan"],
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "Single tool call records one task event",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
				],
				activate: true,
			},
			ctx,
		);

		expect(created.content[0]?.text).toContain("Created task T1");
		expect(store.getState().tasks.T1?.title).toBe("Receiver compatibility");
		const recorded = await execute(
			decision,
			{
				task_id: "T1",
				question: "Which host API style must pi-tasks support?",
				decision:
					"Support both closure-backed and receiver-bound ExtensionAPI methods",
				decided_by: "agent",
				rationale:
					"Pi uses closure-backed methods; OMP may use receiver-bound methods.",
			},
			ctx,
		);

		expect(recorded.content[0]?.text).toContain("Recorded decision D1");
		expect(store.getState().tasks.T1?.decisions[0]?.decision).toBe(
			"Support both closure-backed and receiver-bound ExtensionAPI methods",
		);
	});

	it("does not consume task IDs for rejected task_plan calls", async () => {
		const { tools, ctx, store } = createHarness();
		const plan = requireTool(tools, "task_plan");

		const rejected = await execute(
			plan,
			{
				title: "Bad plan",
				objective: "Exercise rejection",
				acceptance_criteria: ["Bad plan is rejected"],
				plan_steps: [
					{
						text: "Do the thing",
						expectedOutput: "Something happens",
						evidenceRequired: true,
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "Too vague on purpose",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
				],
				activate: true,
			},
			ctx,
		);
		expect(rejected.content[0]?.text).toContain("Error:");
		expect(Object.keys(store.getState().tasks)).toEqual([]);

		const created = await execute(
			plan,
			{
				title: "Good plan",
				objective: "Create a valid task after a rejected plan",
				acceptance_criteria: ["Valid plan is recorded"],
				plan_steps: [
					{
						text: "Record valid plan evidence",
						expectedOutput: "Valid plan evidence is ready",
						evidenceRequired: true,
						allowedActions: ["task_evidence"],
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "Single evidence recording action",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
				],
				activate: true,
			},
			ctx,
		);

		expect(created.content[0]?.text).toContain("Created task T1");
		expect(store.getState().tasks.T1?.id).toBe("T1");
	});

	it("emits a schema-valid task_plan scaffold from rejection recovery", async () => {
		const { tools, ctx, store } = createHarness();
		const plan = requireTool(tools, "task_plan");

		const rejected = await execute(
			plan,
			{
				title: "Reject me",
				objective: "Force the no-active-task recovery branch",
				acceptance_criteria: ["Recovery is a copyable scaffold"],
				plan_steps: [
					// Intentionally invalid: short text, vague output, no granularity
					// contract. Triggers TaskTransitionError before any task is created.
					{
						text: "Do thing",
						expectedOutput: "done",
						evidenceRequired: false,
						allowedActions: [],
					},
				],
				activate: true,
			},
			ctx,
		);

		expect(rejected.isError).toBe(true);
		expect(rejected.content[0]?.text).toContain("Error:");
		// The previous shape was `{ plan_steps: ["<atomic step contract>"] }`,
		// which is `string[]` and rejected by the plan_steps schema. The fix
		// emits a copyable, schema-valid scaffold.
		const details = rejected.details as {
			rejected?: boolean;
			reason?: string;
			retry_with?: string;
			minimum_params?: Record<string, unknown>;
		};
		expect(details.rejected).toBe(true);
		expect(details.retry_with).toBe("task_plan");

		const minimumParams = details.minimum_params;
		expect(minimumParams).toBeDefined();
		// Top-level fields required by the task_plan schema.
		expect(typeof minimumParams?.title).toBe("string");
		expect(typeof minimumParams?.objective).toBe("string");
		expect(Array.isArray(minimumParams?.acceptance_criteria)).toBe(true);
		expect(minimumParams?.activate).toBe(true);

		// plan_steps must be an array of objects, each with a complete
		// granularityCheck. The previous shape (array of strings) failed the
		// schema at resubmit time.
		const planSteps = minimumParams?.plan_steps as Array<
			Record<string, unknown>
		>;
		expect(Array.isArray(planSteps)).toBe(true);
		expect(planSteps.length).toBeGreaterThan(0);
		for (const step of planSteps) {
			expect(typeof step.text).toBe("string");
			expect((step.text as string).length).toBeGreaterThanOrEqual(8);
			expect(typeof step.expectedOutput).toBe("string");
			expect((step.expectedOutput as string).length).toBeGreaterThanOrEqual(12);
			expect(step.evidenceRequired).toBe(true);
			expect(Array.isArray(step.allowedActions)).toBe(true);
			const allowed = step.allowedActions as string[];
			expect(allowed.length).toBeGreaterThan(0);
			expect(allowed.length).toBeLessThanOrEqual(3);
			expect([
				"atomic",
				"needs_breakdown",
				"breaking_down",
				"deferred",
			]).toContain(step.decompositionStatus);
			const check = step.granularityCheck as Record<string, unknown>;
			expect(typeof check.isAtomic).toBe("boolean");
			expect(typeof check.reason).toBe("string");
			expect((check.reason as string).length).toBeGreaterThan(0);
			expect(typeof check.canBeDoneInOneAgentAction).toBe("boolean");
			expect(typeof check.hasSingleObservableOutput).toBe("boolean");
			expect(typeof check.hasSingleVerificationMethod).toBe("boolean");
			expect(typeof check.hasNoHiddenSubtasks).toBe("boolean");
		}

		// End-to-end proof: the recovery scaffold, when filled in with real
		// values and resubmitted to task_plan, creates a valid task. The
		// placeholders alone are not a real plan; fill in concrete values.
		const realParams = {
			...minimumParams,
			title: "Refilled recovery plan",
			objective: "Verify the scaffold round-trips through task_plan",
			acceptance_criteria: [
				"Task is created from the recovery scaffold",
				"Task becomes active immediately",
			],
			plan_steps: [
				{
					text: "Refill and submit the recovery plan",
					expectedOutput: "Recovery plan creates task T1",
					criterionIds: ["T1-AC1"],
					evidenceRequired: true,
					allowedActions: ["task_evidence"],
					decompositionStatus: "atomic" as const,
					granularityCheck: {
						isAtomic: true,
						reason: "Single refill-and-submit action",
						canBeDoneInOneAgentAction: true,
						hasSingleObservableOutput: true,
						hasSingleVerificationMethod: true,
						hasNoHiddenSubtasks: true,
					},
				},
			],
		};
		const created = await execute(plan, realParams, ctx);
		expect(created.content[0]?.text).toContain("Created task");
		expect(store.getState().tasks.T1?.id).toBe("T1");
		expect(store.getState().activeTaskId).toBe("T1");
	});

	it("create, update, evidence, complete, and replay through custom entries", async () => {
		const { tools, entries, ctx, store, ui } = createHarness();
		const plan = requireTool(tools, "task_plan");
		const update = requireTool(tools, "task_update");
		const evidence = requireTool(tools, "task_evidence");
		const complete = requireTool(tools, "task_complete");
		const focus = requireTool(tools, "task_focus");
		const next = requireTool(tools, "task_next");
		const resume = requireTool(tools, "task_resume");

		const created = await execute(
			plan,
			{
				title: "Tool MVP",
				objective: "Verify tools",
				acceptance_criteria: ["Tool creates task"],
				plan_steps: [
					{
						text: "Verify tool harness",
						expectedOutput: "Harness evidence is recorded",
						criterionIds: ["T1-AC1"],
						evidenceRequired: true,
						allowedActions: ["run unit harness"],
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "Single tool harness assertion",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
				],
				activate: true,
			},
			ctx,
		);
		expect(created.content[0]?.text).toContain("pi-tasks resume");
		expect(created.details).toMatchObject({ taskId: "T1" });
		expect((created.details as { tasks?: unknown }).tasks).toBeUndefined();
		expect(ui.status).toContain("Task T1 active");
		expect(ui.widget?.join("\n")).toContain("Active task: T1");
		const focused = await execute(focus, {}, ctx);
		expect(focused.content[0]?.text).toContain("Current step: T1-S1");
		expect(focused.content[0]?.text).toContain("Expected output");
		const nextResult = await execute(next, {}, ctx);
		expect(nextResult.content[0]?.text).toContain("Recommended tool");
		expect(nextResult.content[0]?.text).toContain("Current step lock: T1-S1");
		const resumed = await execute(resume, {}, ctx);
		expect(resumed.content[0]?.text).toContain("pi-tasks resume");
		expect(resumed.content[0]?.text).toContain("Current step: T1-S1");
		await execute(
			update,
			{ task_id: "T1", progress: 50, next_action: "attach evidence" },
			ctx,
		);
		const rejected = await execute(
			complete,
			{ task_id: "T1", summary: "too soon", evidence_ids: [] },
			ctx,
		);
		expect(rejected.isError).toBe(true);
		expect(rejected.content[0]?.text).toContain("retry_with");
		expect(rejected.content[0]?.text).toContain("pi-tasks resume");
		expect(rejected.details).toMatchObject({
			rejected: true,
			do_not_retry_same_call: true,
		});
		const firstEvidence = await execute(
			evidence,
			{
				task_id: "T1",
				type: "test",
				level: "unit_test",
				summary: "fake tool harness passed",
				passed: "true",
				references: ["vitest tool harness"],
				criterion_ids: ["T1-AC1"],
				step_ids: ["T1-S1"],
				quality: {
					source: "vitest",
					reproducible: true,
					verifier: "tool",
					artifactRefs: ["vitest tool harness"],
					observedOutput: "fake tool harness passed",
				},
			},
			ctx,
		);
		expect(firstEvidence.content[0]?.text).toContain("Recorded evidence");
		expect(
			(firstEvidence.details as { tasks?: unknown }).tasks,
		).toBeUndefined();
		const duplicateEvidence = await execute(
			evidence,
			{
				task_id: "T1",
				type: "test",
				level: "unit_test",
				summary: "fake tool harness passed",
				passed: "true",
				references: ["vitest tool harness"],
				criterion_ids: ["T1-AC1"],
				step_ids: ["T1-S1"],
				quality: {
					source: "vitest",
					reproducible: true,
					verifier: "tool",
					artifactRefs: ["vitest tool harness"],
					observedOutput: "fake tool harness passed",
				},
			},
			ctx,
		);
		expect(duplicateEvidence.content[0]?.text).toContain(
			"Evidence already recorded",
		);
		expect(store.getState().tasks.T1?.evidence).toHaveLength(1);
		await execute(
			update,
			{ task_id: "T1", step_id: "T1-S1", step_status: "done" },
			ctx,
		);
		await execute(
			complete,
			{ task_id: "T1", summary: "done", evidence_ids: ["E1"] },
			ctx,
		);

		expect(store.getState().tasks.T1?.status).toBe("done");
		expect(entries).toHaveLength(5);
		expect(ui.status).toBeUndefined();

		const replayed = createTaskRuntimeStore();
		replayed.replay(ctx.sessionManager.getBranch());
		expect(replayed.getState().tasks.T1?.status).toBe("done");
	});

	it("atomically verifies the current step and makes exact retries a no-op", async () => {
		const { tools, entries, ctx, store } = createHarness();
		const plan = requireTool(tools, "task_plan");
		const verify = requireTool(tools, "task_verify_step");
		await execute(
			plan,
			{
				title: "Atomic verification",
				objective: "Record proof and advance in one event",
				acceptance_criteria: ["The first step is verified"],
				plan_steps: [
					{
						text: "Run focused verification",
						expectedOutput: "Focused verification passes",
						criterionIds: ["T1-AC1"],
						evidenceRequired: true,
						allowedActions: ["npm test"],
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "One test command has one observable result",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
					{
						text: "Inspect the package artifact",
						expectedOutput: "Package artifact is valid",
						evidenceRequired: true,
						allowedActions: ["npm pack --dry-run"],
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "One package command has one observable result",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
				],
				activate: true,
			},
			ctx,
		);

		const params = {
			task_id: "T1",
			step_id: "T1-S1",
			type: "test",
			level: "unit_test",
			summary: "Focused unit test passed",
			references: ["test/unit/tools.test.ts"],
			quality: {
				source: "npm test",
				reproducible: true,
				verifier: "tool",
				artifactRefs: ["test/unit/tools.test.ts"],
				observedOutput: "all focused tests passed",
			},
		};
		const before = entries.length;
		const verified = await execute(verify, params, ctx);

		expect(verified.isError).not.toBe(true);
		expect(entries).toHaveLength(before + 1);
		expect(entries.at(-1)?.type).toBe("task.step_verified");
		expect(store.getState().tasks.T1?.planSteps[0]?.status).toBe("done");
		expect(store.getState().tasks.T1?.planSteps[1]?.status).toBe("active");
		expect(store.getState().tasks.T1?.evidence).toHaveLength(1);
		expect(store.getState().tasks.T1?.acceptanceCriteria[0]?.status).toBe(
			"satisfied",
		);

		const retried = await execute(verify, params, ctx);
		expect(retried.content[0]?.text).toContain("retry made no changes");
		expect(entries).toHaveLength(before + 1);
		expect(store.getState().tasks.T1?.evidence).toHaveLength(1);

		const changedQuality = await execute(
			verify,
			{
				...params,
				quality: { ...params.quality, reproducible: false },
			},
			ctx,
		);
		expect(changedQuality.isError).toBe(true);
		expect(changedQuality.content[0]?.text).toContain(
			"evidence must be reproducible",
		);
		expect(entries).toHaveLength(before + 1);

		const changedCriteria = await execute(
			verify,
			{ ...params, criterion_ids: ["T1-AC999"] },
			ctx,
		);
		expect(changedCriteria.isError).toBe(true);
		expect(changedCriteria.content[0]?.text).toContain(
			"Verification criteria must belong to plan step T1-S1",
		);
		expect(entries).toHaveLength(before + 1);
	});

	it("decomposes a coarse step before execution", async () => {
		const { tools, ctx, store } = createHarness();
		const plan = requireTool(tools, "task_plan");
		const check = requireTool(tools, "task_granularity_check");
		const decompose = requireTool(tools, "task_decompose");
		const update = requireTool(tools, "task_update");

		await execute(
			plan,
			{
				title: "Recursive breakdown",
				objective: "Verify decomposition gate",
				acceptance_criteria: ["Step is atomic before execution"],
				plan_steps: [
					{
						text: "Implement release workflow",
						expectedOutput: "Release workflow is verified",
						criterionIds: ["T1-AC1"],
						evidenceRequired: true,
						allowedActions: ["inspect", "build", "test"],
						granularityCheck: {
							isAtomic: false,
							reason: "Contains multiple hidden verification subtasks",
							canBeDoneInOneAgentAction: false,
							hasSingleObservableOutput: false,
							hasSingleVerificationMethod: false,
							hasNoHiddenSubtasks: false,
						},
					},
				],
			},
			ctx,
		);
		const checkResult = await execute(check, {}, ctx);
		expect(checkResult.content[0]?.text).toContain("Next allowed action");
		const rejected = await execute(
			update,
			{ task_id: "T1", step_id: "T1-S1", step_status: "done" },
			ctx,
		);
		expect(rejected.isError).toBe(true);
		expect(rejected.content[0]?.text).toContain("task_decompose");
		await execute(
			decompose,
			{
				task_id: "T1",
				step_id: "T1-S1",
				reason: "Split into atomic verification steps",
				child_steps: [
					{
						text: "Run package dry-run",
						expectedOutput: "npm pack dry-run succeeds",
						criterionIds: ["T1-AC1"],
						evidenceRequired: true,
						allowedActions: ["npm pack --dry-run"],
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "Single packaging command with one output",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
					{
						text: "Record package dry-run evidence",
						expectedOutput: "Evidence is attached to criterion",
						criterionIds: ["T1-AC1"],
						evidenceRequired: true,
						allowedActions: ["task_evidence"],
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "Single evidence recording action",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
				],
			},
			ctx,
		);
		expect(store.getState().tasks.T1?.planSteps[0]?.id).toBe("T1-S1.1");
		expect(store.getState().tasks.T1?.planSteps[0]?.status).toBe("active");
		expect(store.getState().tasks.T1?.currentStep).toBe("Run package dry-run");
	});

	it("checkpoints resume state as a snapshot custom entry", async () => {
		const { tools, entries, ctx } = createHarness();
		const plan = requireTool(tools, "task_plan");
		const checkpoint = requireTool(tools, "task_checkpoint");
		await execute(
			plan,
			{
				title: "Checkpoint",
				objective: "Verify checkpoint",
				acceptance_criteria: ["checkpoint exists"],
				plan_steps: [
					{
						text: "Create checkpoint",
						expectedOutput: "Snapshot includes resume",
						criterionIds: ["T1-AC1"],
						evidenceRequired: true,
						allowedActions: ["task_checkpoint"],
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "Single checkpoint action",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
				],
			},
			ctx,
		);
		const result = await execute(
			checkpoint,
			{ reason: "before compaction" },
			ctx,
		);
		expect(result.content[0]?.text).toContain("Checkpointed");
		const latestEntry = entries.at(-1);
		expect(latestEntry?.type).toBe("task.snapshot");
		expect(
			latestEntry?.type === "task.snapshot" && latestEntry.resume.currentStepId,
		).toBe("T1-S1");
	});
});
