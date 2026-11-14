import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../../src/pi-types.ts";
import { PLAN_SEMANTIC_SYSTEM_PROMPT } from "../../src/semantic-assessment.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";
import { registerTaskTools } from "../../src/tools.ts";
import { assertSchema } from "./assert-schema.ts";
import { fakeSemanticRuntime } from "./semantic-fixture.ts";

function example(path: string): Record<string, unknown> {
	const document = readFileSync(new URL(path, import.meta.url), "utf8");
	return JSON.parse(document.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? "null");
}
const compact = example("../../docs/compact-planning.md");
const detailed = example("../../docs/review-publication-contracts.md");
const observations =
	"Synthetic candidate H1: focused verification passed; independent review completed without findings; required CI passed; ownership rechecked; separate commit, push and PR receipts match H1. No real operations occurred.";

function harness() {
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const events: unknown[] = [];
	const policies: unknown[] = [];
	const runtime = fakeSemanticRuntime();
	const classify = runtime.modelRegistry?.classify;
	if (!classify) throw new Error("Missing fixture classifier");
	const ctx: ExtensionContext = {
		...runtime,
		modelRegistry: {
			...runtime.modelRegistry,
			async classify(model, context, options) {
				policies.push(context.state.policy);
				return classify(model, context, options);
			},
		},
		sessionManager: { getBranch: () => [] },
		ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
	};
	const pi: ExtensionAPI = {
		on: () => {},
		registerCommand: () => {},
		registerTool: (tool) => tools.set(tool.name, tool),
		appendEntry: (_type, event) => {
			events.push(event);
		},
	};
	const store = createTaskRuntimeStore();
	registerTaskTools(pi, store);
	let calls = 0;
	return {
		store,
		events,
		policies,
		tools,
		calls: () => calls,
		async call(name: string, params: Record<string, unknown>, fails = false) {
			const tool = tools.get(name);
			if (!tool) throw new Error(`Missing ${name}`);
			assertSchema(tool.parameters, params);
			calls++;
			const result = await tool.execute(
				"fixture",
				params,
				undefined,
				undefined,
				ctx,
			);
			expect(result.isError === true, result.content[0]?.text).toBe(fails);
			return result;
		},
	};
}

function proof() {
	return {
		type: "review",
		level: "unit_test",
		summary: observations,
		references: ["fixture:H1"],
		quality: {
			source: "controlled review handoff",
			reproducible: true,
			verifier: "tool",
			command: "inspect synthetic H1 gate observations",
			artifactRefs: ["fixture:H1"],
			observedOutput: observations,
		},
	};
}

async function retainedProof() {
	const h = harness();
	await h.call("task_plan", {
		...compact,
		acceptance_criteria: [(compact.acceptance_criteria as string[])[1]],
		plan_steps: [
			{
				...(compact.plan_steps as Record<string, unknown>[])[1],
				criterionRefs: [1],
			},
		],
	});
	await h.call("task_evidence", {
		task_id: "T1",
		...proof(),
		passed: "true",
		step_ids: ["T1-S1"],
		criterion_ids: ["T1-AC1"],
	});
	const id = h.store.getState().tasks.T1?.evidence[0]?.id;
	if (!id) throw new Error("Missing retained receipt");
	return { h, id };
}

async function finish(
	h: ReturnType<typeof harness>,
	ids: string[],
	fails = false,
) {
	return h.call(
		"task_complete",
		{
			task_id: "T1",
			summary: "Controlled fixture complete",
			evidence_ids: ids,
		},
		fails,
	);
}

describe("compact standalone planning and retained receipts", () => {
	it("reduces the bounded detailed handoff from ten submissions to four with the same synthetic gate observations", async () => {
		const counts: number[] = [];
		for (const plan of [detailed, compact]) {
			const h = harness();
			await h.call("task_plan", plan);
			expect(h.policies[0]).toBe(PLAN_SEMANTIC_SYSTEM_PROMPT);
			const steps = h.store.getState().tasks.T1?.planSteps ?? [];
			for (const step of steps) {
				await h.call("task_verify_step", {
					task_id: "T1",
					step_id: step.id,
					...proof(),
					criterion_ids: step.criterionIds,
				});
			}
			const task = h.store.getState().tasks.T1;
			await finish(h, task?.evidence.map((e) => e.id) ?? []);
			expect(h.store.getState().tasks.T1?.status).toBe("done");
			expect(
				task?.acceptanceCriteria.every((c) => c.status === "satisfied"),
			).toBe(true);
			expect(
				task?.evidence.every((e) => e.quality.observedOutput === observations),
			).toBe(true);
			counts.push(h.calls());
		}
		expect(counts).toEqual([10, 4]);
	});

	it("reuses assessed review provenance by ID without additional inference or prose", async () => {
		const { h, id } = await retainedProof();
		const assessments = h.policies.length;
		const before = structuredClone(h.store.getState().tasks.T1?.evidence);
		await h.call("task_update", {
			task_id: "T1",
			step_id: "T1-S1",
			step_status: "done",
			step_evidence_ids: [id],
		});
		await finish(h, [id]);
		expect(h.policies).toHaveLength(assessments);
		expect(h.store.getState().tasks.T1?.status).toBe("done");
		expect(h.store.getState().tasks.T1?.evidence[0]).toEqual(before?.[0]);
	});

	it("cannot replace missing verification with an unproved receipt ID", async () => {
		const h = harness();
		await h.call("task_plan", compact);
		const before = structuredClone(h.store.getState());
		await h.call(
			"task_update",
			{
				task_id: "T1",
				step_id: "T1-S1",
				step_status: "done",
				step_evidence_ids: ["missing-review"],
			},
			true,
		);
		await finish(h, [], true);
		expect(h.store.getState()).toEqual(before);
	});

	it("does not let recorded receipts clear a persisted lost-ownership gate", async () => {
		const { h, id } = await retainedProof();
		await h.call("task_update", {
			task_id: "T1",
			step_id: "T1-S1",
			step_status: "done",
			step_evidence_ids: [id],
		});
		await h.call("task_update", {
			task_id: "T1",
			status: "blocked",
			blocker: {
				reason: "Live ownership check failed for H1",
				blockedBy: "external",
				neededToUnblock: "Reacquire ownership through the owning workflow",
			},
		});
		const before = structuredClone(h.store.getState());
		await finish(h, [id], true);
		expect(h.store.getState()).toEqual(before);
		expect(
			h.store.getState().tasks.T1?.blockers[0]?.resolvedAt,
		).toBeUndefined();
	});

	it("requires new affected proof after a changed-head rework instead of laundering the old receipt", async () => {
		const { h, id } = await retainedProof();
		await h.call("task_update", {
			task_id: "T1",
			step_id: "T1-S1",
			step_status: "done",
			step_evidence_ids: [id],
		});
		await h.call("task_rework", {
			task_id: "T1",
			reason:
				"Candidate changed from H1 to H2; previous review is historical, not current proof",
			plan_steps: [
				{
					text: "Verify the reviewed H2 candidate",
					expectedOutput: "Independent review and required verification for H2",
					allowedActions: ["Review H2 and retain fresh affected proof"],
					criterionIds: ["T1-AC1"],
				},
			],
		});
		const current = h.store
			.getState()
			.tasks.T1?.planSteps.find((s) => s.status === "active");
		const before = structuredClone(h.store.getState());
		await h.call(
			"task_update",
			{
				task_id: "T1",
				step_id: current?.id,
				step_status: "done",
				step_evidence_ids: [id],
			},
			true,
		);
		await finish(h, [id], true);
		expect(h.store.getState()).toEqual(before);
	});

	it("mirrors compact planning in the effective tool and shared native policy without removing operation gates", () => {
		const h = harness();
		expect(h.tools.get("task_plan")?.description).toContain(
			"compact deliverable checklist",
		);
		expect(h.tools.get("task_plan")?.description).toContain(
			"Nexus is authoritative",
		);
		expect(PLAN_SEMANTIC_SYSTEM_PROMPT).toContain(
			"do not require receipt-only decomposition",
		);
		expect(PLAN_SEMANTIC_SYSTEM_PROMPT).toContain(
			"exact-head verification gates remain mandatory",
		);
	});
});
