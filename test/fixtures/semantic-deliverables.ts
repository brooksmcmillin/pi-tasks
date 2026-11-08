import type { PlanAssessmentInput } from "../../src/semantic-assessment.ts";

export interface DeliverableCase {
	id: string;
	expected: "atomic" | "needs_breakdown" | "rejected";
	why: string;
	input: PlanAssessmentInput;
}

const batch = {
	title: "Publish the reviewed repair-task graph",
	objective:
		"Publish one reviewed eight-item repair batch and its formal dependency graph. Do not implement the repairs or execute the original trial.",
	acceptanceCriteria: [
		"All eight reviewed tasks and only the reviewed dependency edges are visible in the readback.",
	],
};
const batchStep = {
	expectedOutput:
		"One published eight-task graph matching the reviewed batch, with a readback comparison of task identities and edges.",
	allowedActions: [
		"Publish the reviewed batch and dependency edges",
		"Compare the persisted graph to the reviewed batch",
	],
	evidenceRequired: true,
};

// Labels are reviewed product expectations, not a keyword oracle or native-model results.
export const deliverableCases: DeliverableCase[] = [
	{
		id: "batch-prose",
		expected: "atomic",
		why: "Task records, dependency edges and readback are inseparable parts of one bounded graph publication, not eight independent repair implementations.",
		input: {
			...batch,
			steps: [
				{
					...batchStep,
					text: "Publish the reviewed repair-task batch and dependency graph, then verify the persisted graph against the reviewed batch.",
				},
			],
		},
	},
	{
		id: "batch-command",
		expected: "atomic",
		why: "Equivalent to batch-prose; naming a command must not change the deliverable boundary.",
		input: {
			...batch,
			steps: [
				{
					...batchStep,
					text: "Run task-batch-author on the reviewed repair batch with dependency-graph readback verification.",
				},
			],
		},
	},
	{
		id: "bounded-report",
		expected: "atomic",
		why: "Reading three evidence seams and comparing their findings supports one investigation report; the reads are not separate deliverables.",
		input: {
			objective:
				"Explain why one local repair batch required cosmetic plan retries; no code changes or production task mutations.",
			acceptanceCriteria: [
				"One sourced report distinguishes context loss from legitimate decomposition.",
			],
			steps: [
				{
					text: "Produce a bounded investigation report from the retained session, assessor prompt and tool adapters.",
					expectedOutput:
						"One report explaining the observed retries with path/line evidence and explicit uncertainty.",
					allowedActions: [
						"Inspect the three named evidence seams",
						"Cross-check each report claim against its cited source",
					],
				},
			],
		},
	},
	{
		id: "focused-repair",
		expected: "atomic",
		why: "Implementation and focused unit/replay assertions jointly verify one context-preservation contract.",
		input: {
			objective:
				"Preserve bounded scope and verification context in the plan assessment adapter, not redesign the task reducer.",
			acceptanceCriteria: [
				"The model receives the supplied scope and verification plan without changing step identity.",
			],
			steps: [
				{
					text: "Fix the plan-assessment adapter's dropped context with focused unit and replay regressions.",
					expectedOutput:
						"One context-preservation fix with unit and replay assertions demonstrating unchanged step identity.",
					allowedActions: [
						"Update the assessment adapter",
						"Run focused context-preservation unit and replay tests",
					],
				},
			],
		},
	},
	{
		id: "independent-products",
		expected: "needs_breakdown",
		why: "An OAuth feature and a billing dashboard are independently useful, reviewable products despite one command wrapper.",
		input: {
			objective:
				"Deliver OAuth refresh support and an unrelated billing dashboard.",
			acceptanceCriteria: [
				"Expired OAuth sessions refresh.",
				"The billing dashboard charts invoices.",
			],
			steps: [
				{
					text: "Run ship-products to implement OAuth refresh support and build the billing dashboard.",
					expectedOutput:
						"Working OAuth refresh support plus a separately deployable billing dashboard.",
					allowedActions: [
						"Implement both products",
						"Verify OAuth refresh and billing charts independently",
					],
				},
			],
		},
	},
	{
		id: "publish-and-implement",
		expected: "needs_breakdown",
		why: "Publishing a task graph and implementing its independent cross-system repairs are distinct outcomes; batch wording does not collapse them.",
		input: {
			...batch,
			objective:
				"Publish the reviewed graph and implement its OAuth, scheduler and metrics repairs.",
			steps: [
				{
					text: "Publish the repair batch and implement all its cross-system repairs.",
					expectedOutput:
						"A published graph, working OAuth renewal, scheduler recovery and metrics export.",
					allowedActions: [
						"Publish the graph",
						"Implement and independently test each repair",
					],
				},
			],
		},
	},
	{
		id: "missing-boundary",
		expected: "rejected",
		why: "Neither the target, owned boundary nor observable result is supplied; the smallest correction is missing context, not invented children.",
		input: {
			objective: "Improve things.",
			acceptanceCriteria: ["It is better."],
			steps: [
				{
					text: "Fix the remaining issues.",
					expectedOutput: "Everything is done.",
					allowedActions: ["Make the needed changes"],
				},
			],
		},
	},
	{
		id: "mixed-language-batch",
		expected: "atomic",
		why: "The same bounded graph publication in mixed-language prose must not need an English command rewrite.",
		input: {
			...batch,
			steps: [
				{
					...batchStep,
					text: "發布已審核的八項 repair-task batch 與 dependency graph，並以 readback 核對整份圖。",
				},
			],
		},
	},
];
