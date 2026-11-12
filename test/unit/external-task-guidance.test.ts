import { describe, expect, it } from "vitest";
import taskExtension from "../../index.ts";
import { TASK_EVENT_CUSTOM_TYPE } from "../../src/model.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../../src/pi-types.ts";
import { fakeSemanticRuntime } from "./semantic-fixture.ts";

function session(initial: unknown[] = []) {
	const entries = structuredClone(initial);
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const hooks = new Map<
		string,
		(event: unknown, ctx: ExtensionContext) => unknown
	>();
	const pi: ExtensionAPI = {
		events: { emit() {}, on: () => () => {} },
		on(name, handler) {
			hooks.set(
				name,
				handler as (event: unknown, ctx: ExtensionContext) => unknown,
			);
		},
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
		appendEntry(customType, data) {
			entries.push({ type: "custom", customType, data });
		},
	};
	const ctx: ExtensionContext = {
		...fakeSemanticRuntime(),
		sessionManager: {
			getBranch: () =>
				entries as ReturnType<ExtensionContext["sessionManager"]["getBranch"]>,
		},
		ui: { notify() {}, setStatus() {}, setWidget() {} },
	};
	taskExtension(pi);
	return {
		entries,
		tools,
		start: () => hooks.get("session_start")?.({}, ctx),
		call: (name: string, args = {}) => {
			const tool = tools.get(name);
			if (!tool) throw new Error(`Missing fixture tool: ${name}`);
			return tool.execute("fixture", args, undefined, undefined, ctx);
		},
	};
}

describe("external task guidance", () => {
	it("scopes every injected planning rule and description, including legacy hosts", () => {
		const { tools } = session();
		for (const tool of tools.values()) {
			expect(tool.description).toContain("Nexus is authoritative");
			for (const guideline of tool.promptGuidelines ?? []) {
				expect(
					guideline.startsWith("For standalone Pi contracts only:") ||
						guideline.startsWith("For Nexus-managed work,"),
				).toBe(true);
			}
		}
		for (const name of ["task_plan", "task_resume"]) {
			expect(tools.get(name)?.promptSnippet).toContain(
				"Optional for Nexus-managed work",
			);
			expect(tools.get(name)?.description).toContain(
				"obsolete commit is not current proof",
			);
		}
	});

	it("starts a fresh session without importing the previous plan store; keeps old history readable", async () => {
		const a = session();
		await a.start();
		await a.call("task_plan", {
			title: "Old local plan",
			objective: "Implement fixture behavior",
			acceptance_criteria: ["Fixture behavior verified"],
			plan_steps: [
				{
					text: "Implement fixture behavior",
					expectedOutput: "Tested fixture behavior",
					allowedActions: ["edit and test fixture"],
				},
			],
		});
		expect(a.entries.length).toBeGreaterThan(0);
		const retained = structuredClone(a.entries);
		const b = session();
		await b.start();
		expect(b.entries).toEqual([]);
		const stale = session(retained);
		await stale.start();
		const history = await stale.call("task_list", { include_history: true });
		expect(JSON.stringify(history)).toContain("Old local plan");
		expect(stale.entries).toEqual(retained);
		expect(a.entries).toEqual(retained);
	});

	it("replays malformed local history without forcing reconstruction or mutation", async () => {
		const malformed = [
			{
				type: "custom",
				customType: TASK_EVENT_CUSTOM_TYPE,
				data: { version: 2, type: "task.created" },
			},
		];
		const s = session(malformed);
		await s.start();
		expect(s.entries).toEqual(malformed);
	});
});
