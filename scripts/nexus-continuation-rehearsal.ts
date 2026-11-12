import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import taskExtension from "../index.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../src/pi-types.ts";
import { fakeSemanticRuntime } from "../test/unit/semantic-fixture.ts";

const closeoutPath = process.argv[2];
assert.ok(
	closeoutPath,
	"Pass the changed infra .pi/extensions/closeout/state.ts path",
);
const { default: closeout } = await import(
	pathToFileURL(resolve(closeoutPath)).href
);
type Hook = (event: unknown, ctx: ExtensionContext) => unknown;

function session(id: string, initial: unknown[] = []) {
	const entries = structuredClone(initial);
	let closed = false;
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const hooks = new Map<string, Hook[]>();
	const listeners = new Map<string, Set<(data: unknown) => void>>();
	const pi: ExtensionAPI = {
		on(name, handler) {
			hooks.set(name, [...(hooks.get(name) ?? []), handler as Hook]);
		},
		events: {
			on(name, handler) {
				const handlers = listeners.get(name) ?? new Set();
				handlers.add(handler);
				listeners.set(name, handlers);
				return () => {
					handlers.delete(handler);
				};
			},
			emit(name, data) {
				for (const handler of listeners.get(name) ?? []) handler(data);
			},
		},
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
		appendEntry(customType, data) {
			entries.push({ type: "custom", customType, data });
		},
	};
	// Git/GitHub and semantic model transport are simulated; production tool and
	// closeout implementations run unchanged, without network or paid inference.
	Object.assign(pi, {
		exec: async () => ({
			code: 1,
			stdout: "",
			stderr: "fixture",
			killed: false,
		}),
	});
	const ctx: ExtensionContext = {
		...fakeSemanticRuntime(),
		cwd: "/disposable-fixture",
		sessionManager: {
			getSessionId: () => id,
			getBranch: () => {
				assert.equal(closed, false, "Original session store is inaccessible");
				return entries as ReturnType<
					ExtensionContext["sessionManager"]["getBranch"]
				>;
			},
		},
		ui: { notify() {}, setStatus() {}, setWidget() {} },
	};
	Object.assign(ctx.ui, {
		theme: { fg: (_color: string, text: string) => text },
	});
	taskExtension(pi);
	closeout(pi, {});
	async function fire(name: string) {
		for (const hook of hooks.get(name) ?? []) await hook({}, ctx);
	}
	return {
		entries,
		tools,
		start: () => fire("session_start"),
		stop: async () => {
			await fire("session_shutdown");
			closed = true;
		},
		call: (name: string, args: Record<string, unknown> = {}) => {
			const tool = tools.get(name);
			assert.ok(tool, `Missing fixture tool: ${name}`);
			return tool.execute("fixture", args, undefined, undefined, ctx);
		},
	};
}

const a = session("A");
await a.start();
await a.call("task_plan", {
	title: "Session A working plan",
	objective: "Implement disposable fixture",
	acceptance_criteria: ["Disposable behavior verified"],
	plan_steps: [
		{
			text: "Implement disposable behavior",
			expectedOutput: "Verified disposable behavior",
			allowedActions: ["edit and verify fixture"],
		},
	],
});
const retainedHistory = JSON.stringify(a.entries);
assert.match(retainedHistory, /Session A working plan/);
await a.stop();

const handoff = {
	task_id: "7987",
	pr: "disposable PR",
	head: "head-B",
	verificationHead: "head-A",
	nextAction: "verify current head",
	authorized: true,
};
const b = session("B", [
	{
		message: {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "read-task",
					name: "nexus_get_task",
					arguments: { task_id: handoff.task_id },
				},
			],
		},
	},
	{
		message: {
			role: "toolResult",
			toolCallId: "read-task",
			toolName: "nexus_get_task",
			content: [
				{
					type: "text",
					text: JSON.stringify({
						task: { id: "task_7987", status: "in_progress", handoff },
					}),
				},
			],
		},
	},
]);
await b.start();
assert.doesNotMatch(
	JSON.stringify(await b.call("task_list", { include_history: true })),
	/Session A working plan/,
);
const planTool = b.tools.get("task_plan");
assert.ok(planTool);
assert.match(planTool.description, /Nexus is authoritative/);
const report = await b.call("closeout");
assert.equal((report.details as { reconciled: boolean }).reconciled, true);
// Fixture action selector checks durable current-head evidence, not local IDs.
function nextAction(value: typeof handoff) {
	if (!value.authorized) return "authorization required";
	if (value.verificationHead !== value.head) return "verify current head";
	return "review current head";
}
assert.equal(nextAction(handoff), handoff.nextAction);
assert.equal(
	nextAction({ ...handoff, authorized: false }),
	"authorization required",
);
assert.equal(
	nextAction({ ...handoff, verificationHead: "head-B" }),
	"review current head",
);
// A genuine closeout ownership violation stays visible despite optional plans.
b.entries.push(
	{
		message: {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "claim",
					name: "nexus_claim_task",
					arguments: { task_id: "7987" },
				},
			],
		},
	},
	{
		message: {
			role: "toolResult",
			toolCallId: "claim",
			toolName: "nexus_claim_task",
			content: [
				{
					type: "text",
					text: JSON.stringify({
						id: "7987",
						claimed: true,
						claimed_until: "2099-01-01T00:00:00Z",
					}),
				},
			],
		},
	},
);
const blocked = await b.call("closeout");
assert.equal((blocked.details as { reconciled: boolean }).reconciled, false);
assert.match(
	JSON.stringify(blocked.content),
	/live-claim-without-private-receipt/,
);
assert.equal(JSON.stringify(a.entries), retainedHistory);
await b.stop();
console.log(
	JSON.stringify(
		{
			node: process.version,
			piTasks: JSON.parse(
				readFileSync(new URL("../package.json", import.meta.url), "utf8"),
			).version,
			closeoutSource: resolve(closeoutPath),
			configuration:
				"Actual extensions, isolated in-memory session branches; synthetic semantic/Git/GitHub/task/PR boundaries; no model or production mutation",
			observations: [
				"B reached verify current head without A plan access",
				"A history retained unchanged",
				"old-head evidence not accepted by fixture action selector",
				"authorization denial remains in fixture selector",
				"real closeout rejects missing private claim receipt",
			],
			limits:
				"Offline deterministic rehearsal, not an installed rollout, model behavior trial or live Nexus authorization test",
		},
		null,
		2,
	),
);
