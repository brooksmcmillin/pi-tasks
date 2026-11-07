import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../../src/pi-types.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";
import { registerTaskTools } from "../../src/tools.ts";
import { assertSchema } from "./assert-schema.ts";
import { fakeSemanticRuntime } from "./semantic-fixture.ts";

const document = readFileSync(
	new URL("../../docs/review-publication-contracts.md", import.meta.url),
	"utf8",
);
const examples = [...document.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
	(match) => JSON.parse(match[1] ?? "") as Record<string, unknown>,
);

function harness() {
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const entries: unknown[] = [];
	const pi: ExtensionAPI = {
		on: () => {},
		registerCommand: () => {},
		registerTool: (tool) => tools.set(tool.name, tool),
		appendEntry: (_type, data) => {
			entries.push(data);
		},
	};
	const ctx: ExtensionContext = {
		sessionManager: { getBranch: () => [] },
		ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
		...fakeSemanticRuntime(),
	};
	const store = createTaskRuntimeStore();
	registerTaskTools(pi, store);
	return {
		store,
		entries,
		async call(name: string, params: Record<string, unknown>) {
			const tool = tools.get(name);
			if (!tool) throw new Error(`Missing ${name}`);
			assertSchema(tool.parameters, params);
			return tool.execute("example", params, undefined, undefined, ctx);
		},
	};
}

describe("review/publication documentation contracts", () => {
	it("replays separate publication receipts in four task calls without real Git or GitHub effects", async () => {
		const h = harness();
		const example = examples[0];
		const steps = (example?.plan_steps as Record<string, unknown>[])
			.slice(-3)
			.map((step) => ({ ...step, criterionRefs: [1] }));
		let calls = 0;
		const call = async (name: string, params: Record<string, unknown>) => {
			calls++;
			const result = await h.call(name, params);
			expect(result.isError, result.content[0]?.text).not.toBe(true);
		};
		await call("task_plan", {
			...example,
			acceptance_criteria: ["Separate publication receipts are retained"],
			plan_steps: steps,
		});
		for (let i = 1; i <= 3; i++) {
			await call("task_verify_step", {
				task_id: "T1",
				step_id: `T1-S${i}`,
				type: "note",
				level: "static_read",
				summary: `Synthetic publication receipt ${i}; no Git or GitHub operation occurred`,
				references: ["test/unit/review-contracts.test.ts"],
				quality: {
					source: "controlled contract replay",
					reproducible: true,
					verifier: "tool",
					command: "vitest run test/unit/review-contracts.test.ts",
					artifactRefs: ["test/unit/review-contracts.test.ts"],
					observedOutput: `Synthetic receipt ${i} retained by the isolated store; not delivery evidence`,
				},
			});
		}
		expect(calls).toBe(4);
		expect(
			h.store.getState().tasks.T1?.planSteps.map((s) => s.evidenceIds.length),
		).toEqual([1, 1, 1]);
		expect(
			h.store.getState().tasks.T1?.planSteps.every((s) => s.status === "done"),
		).toBe(true);
	});

	it("authors eight separately gated deliverables through the registered schema and native boundary", async () => {
		expect(examples).toHaveLength(1);
		const h = harness();
		const result = await h.call("task_plan", examples[0] ?? {});
		expect(result.isError, result.content[0]?.text).not.toBe(true);
		const task = Object.values(h.store.getState().tasks)[0];
		expect(task?.planSteps).toHaveLength(8);
		expect(
			task?.planSteps.every(
				(s) =>
					s.decompositionStatus === "atomic" &&
					s.evidenceRequired &&
					s.evidenceIds.length === 0,
			),
		).toBe(true);
		expect(task?.planSteps.map((s) => s.criterionIds)).toEqual([
			["T1-AC1"],
			["T1-AC1"],
			["T1-AC2"],
			["T1-AC2"],
			["T1-AC2"],
			["T1-AC3"],
			["T1-AC3"],
			["T1-AC3"],
		]);
		const before = h.entries.length;
		const completion = await h.call("task_complete", {
			task_id: "T1",
			summary: "Template loaded",
			evidence_ids: [],
		});
		expect(completion.isError).toBe(true);
		expect(h.entries).toHaveLength(before);
	});

	it("does not exempt the template from a native rejection or persist a rejected plan", async () => {
		const h = harness();
		// The controlled native fixture rejects this title; this tests gate plumbing, not model accuracy.
		const result = await h.call("task_plan", {
			...examples[0],
			title: "Bad plan",
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("resubmit for native assessment");
		expect(h.entries).toHaveLength(0);
		expect(Object.keys(h.store.getState().tasks)).toHaveLength(0);
	});
});
