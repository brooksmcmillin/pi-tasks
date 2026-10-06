import assert from "node:assert/strict";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../src/pi-types.ts";
import { createTaskRuntimeStore } from "../src/store.ts";
import { registerTaskTools } from "../src/tools.ts";

const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
const store = createTaskRuntimeStore();
const pi: ExtensionAPI = {
	on: () => {},
	registerCommand: () => {},
	appendEntry: () => {},
	registerTool: (tool) => tools.set(tool.name, tool),
};
const ctx: ExtensionContext = {
	sessionManager: { getBranch: () => [] },
	ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
};
registerTaskTools(pi, store);
const planTool = tools.get("task_plan");
assert.ok(planTool);
const taskPlanCalls = 1;

const result = await planTool.execute(
	"criterion-link-replay",
	{
		title: "Selective initial criterion links",
		objective:
			"Link implementation, follow-up and publication obligations selectively",
		acceptance_criteria: [
			"Implementation behavior is verified",
			"Follow-up remains separately tracked",
			"Publication gate is recorded",
		],
		plan_steps: [
			{
				text: "Verify implementation behavior",
				expectedOutput: "Implementation behavior check passes",
				allowedActions: ["run focused tests"],
				criterionRefs: [1],
			},
			{
				text: "Verify follow-up scope",
				expectedOutput: "Follow-up scope is recorded",
				allowedActions: ["inspect plan"],
				criterionRefs: [2],
			},
			{
				text: "Verify publication handoff",
				expectedOutput: "Publication gate is recorded",
				allowedActions: ["inspect PR status"],
				criterionRefs: [3],
			},
		],
	},
	undefined,
	undefined,
	ctx,
);
assert.notEqual(result.isError, true, result.content[0]?.text);
assert.deepEqual(
	store.getState().tasks.T1?.planSteps.map((step) => step.criterionIds),
	[["T1-AC1"], ["T1-AC2"], ["T1-AC3"]],
);
assert.equal(taskPlanCalls, 1);

console.log(
	JSON.stringify({
		kind: "sanitized local contract replay; operation counts, not latency",
		taskPlanCalls,
		taskReplanCalls: 0,
		stepCount: 3,
		selectiveLinks: store
			.getState()
			.tasks.T1?.planSteps.map((step) => step.criterionIds),
	}),
);
