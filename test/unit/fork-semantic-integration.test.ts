import { describe, expect, it } from "vitest";
import {
	TASK_EVENT_CUSTOM_TYPE,
	type TaskEvent,
	type TaskStepInput,
} from "../../src/model.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../../src/pi-types.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";
import { registerTaskTools } from "../../src/tools.ts";
import { fakeSemanticRuntime } from "./semantic-fixture.ts";

const step = {
	text: "Certify parser alias behavior",
	expectedOutput: "Parser aliases preserve existing inputs",
	allowedActions: ["execute focused parser tests"],
	evidenceRequired: true,
};
const proof = {
	type: "test",
	level: "unit_test",
	summary: "Parser alias suite passed",
	references: ["parser.test.ts"],
	quality: {
		source: "parser test runner",
		reproducible: true,
		verifier: "tool",
		command: "npm test -- parser.test.ts",
		artifactRefs: ["parser.test.ts"],
		observedOutput: "4 parser alias assertions passed",
	},
};
const cases: Array<[string, Record<string, unknown>]> = [
	[
		"task_replan",
		{ reason: "Correct parser scope", step_ids: ["T1-S1"], plan_steps: [step] },
	],
	[
		"task_rework",
		{ reason: "Review found parser coverage gap", plan_steps: [step] },
	],
	[
		"task_update",
		{
			step_id: "T1-S1",
			step_granularity_check: {
				isAtomic: true,
				reason: "One parser contract",
				canBeDoneInOneAgentAction: true,
				hasSingleObservableOutput: true,
				hasSingleVerificationMethod: true,
				hasNoHiddenSubtasks: true,
			},
		},
	],
	["task_verify_step", { ...proof, step_id: "T1-S1" }],
	[
		"task_evidence_batch",
		{
			entries: [
				{
					...proof,
					operation: "verify_step",
					step_id: "T1-S1",
					passed: "true",
				},
			],
		},
	],
];

async function harness(planStep: TaskStepInput = step) {
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const events: TaskEvent[] = [];
	const publications: string[] = [];
	const store = createTaskRuntimeStore();
	const runtime = fakeSemanticRuntime();
	const registry = runtime.modelRegistry;
	if (!registry?.classify) throw new Error("Missing semantic fixture");
	const classify = registry.classify;
	const ctx: ExtensionContext = {
		...runtime,
		sessionManager: {
			getBranch: () =>
				events.map((data) => ({
					type: "custom",
					customType: TASK_EVENT_CUSTOM_TYPE,
					data,
				})),
		},
		ui: { notify() {}, setStatus() {}, setWidget() {} },
	};
	const pi: ExtensionAPI = {
		on() {},
		registerCommand() {},
		registerTool: (tool) => tools.set(tool.name, tool),
		appendEntry: (_type, data) => events.push(data as TaskEvent),
		events: { emit: (name) => publications.push(name) },
	};
	registerTaskTools(pi, store);
	const call = (
		name: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`Missing tool ${name}`);
		return tool.execute(
			"fork-semantic",
			{ task_id: "T1", ...params },
			signal,
			undefined,
			ctx,
		);
	};
	expect(
		(
			await call("task_plan", {
				title: "Parser integration",
				objective: "Preserve parser alias behavior",
				acceptance_criteria: ["Parser aliases pass"],
				plan_steps: [planStep],
			})
		).isError,
	).not.toBe(true);
	return {
		call,
		ctx,
		events,
		publications,
		store,
		runtime,
		registry,
		classify,
	};
}

describe("fork mutation semantic boundaries", () => {
	it("replays retained v3 creation and contextual classification after a prompt-only upgrade", async () => {
		const check = {
			unit: "deliverable" as const,
			boundedScope: "Parser aliases only; exclude unrelated parser replacement",
			verificationPlan:
				"Run focused parser alias assertions for the fixed candidate",
			isAtomic: true,
			reason: "One bounded parser compatibility outcome",
			canBeDoneInOneAgentAction: true,
			hasSingleObservableOutput: true,
			hasSingleVerificationMethod: true,
			hasNoHiddenSubtasks: true,
		};
		const h = await harness({ ...step, granularityCheck: check });
		expect(
			(
				await h.call("task_update", {
					step_id: "T1-S1",
					step_granularity_check: check,
				})
			).isError,
		).not.toBe(true);
		const historical = structuredClone(h.events);
		for (const event of historical) {
			if (!event.semanticAssessment) throw new Error("Missing assessment");
			// v3 and v4 use the same normalized contextual hash format. Keep the
			// original hashes while restoring the previous assessor's provenance.
			event.semanticAssessment.provenance.promptVersion = "2026-11-07.v3";
		}
		const restored = createTaskRuntimeStore().replay(
			historical.map((data) => ({
				type: "custom",
				customType: TASK_EVENT_CUSTOM_TYPE,
				data,
			})),
		);
		expect(restored.malformedEvents).toEqual([]);
		expect(restored.state.tasks.T1?.planSteps[0]?.decompositionStatus).toBe(
			"atomic",
		);
		expect(
			restored.state.tasks.T1?.planSteps[0]?.granularityCheck.boundedScope,
		).toBe(check.boundedScope);
		expect(
			restored.state.tasks.T1?.planSteps[0]?.granularityCheck.verificationPlan,
		).toBe(check.verificationPlan);
	});

	it.each(cases)(
		"persists assessed %s with deterministic replay",
		async (name, params) => {
			const h = await harness();
			const result = await h.call(name, params);
			expect(result.isError).not.toBe(true);
			expect(result.usage?.totalTokens).toBeGreaterThan(0);
			const event = h.events.at(-1);
			if (!event) throw new Error("Missing persisted event");
			expect(event.version).toBe(2);
			const assessed =
				event.type === "task.evidence_batch" ? event.entries[0] : event;
			expect(assessed).toHaveProperty(
				"semanticAssessment.provenance.strategy",
				"pi_classifier",
			);
			const restored = createTaskRuntimeStore();
			restored.replay(h.ctx.sessionManager.getBranch());
			expect(restored.getState()).toEqual(h.store.getState());
		},
	);

	it.each(cases)(
		"fails closed for unavailable assessment in %s",
		async (name, params) => {
			const h = await harness();
			delete h.ctx.modelRegistry;
			delete h.ctx.model;
			const before = structuredClone(h.store.getState());
			const publications = h.publications.length;
			const result = await h.call(name, params);
			expect(result.isError).toBe(true);
			expect(result.details).toMatchObject({
				retry_with: name,
				native_model_required: true,
			});
			expect(h.store.getState()).toEqual(before);
			expect(h.events).toHaveLength(1);
			expect(h.publications).toHaveLength(publications);
		},
	);

	it.each(cases)(
		"honors cancellation before persisting %s",
		async (name, params) => {
			const h = await harness();
			const controller = new AbortController();
			controller.abort();
			expect((await h.call(name, params, controller.signal)).isError).toBe(
				true,
			);
			expect(h.events).toHaveLength(1);
		},
	);

	it.each(cases)(
		"rejects stale %s assessment after a concurrent mutation",
		async (name, params) => {
			const h = await harness();
			const classify = h.classify;
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			h.registry.classify = async (...args) => {
				entered.resolve();
				await release.promise;
				return classify(...args);
			};
			const pending = h.call(name, params);
			await entered.promise;
			expect((await h.call("task_update", { progress: 12 })).isError).not.toBe(
				true,
			);
			const before = structuredClone(h.store.getState());
			release.resolve();
			const rejected = await pending;
			expect(rejected.isError).toBe(true);
			expect(rejected.content[0]?.text).toContain(
				"changed during semantic assessment",
			);
			expect(h.store.getState()).toEqual(before);
		},
	);

	it.each([
		...cases,
		[
			"task_plan",
			{
				title: "Other parser task",
				objective: "Certify parser output",
				acceptance_criteria: ["Parser passes"],
				plan_steps: [step],
			},
		],
		[
			"task_decompose",
			{
				step_id: "T1-S1",
				reason: "Separate parser cases",
				child_steps: [step, step],
			},
		],
		["task_evidence", { ...proof, passed: "true", step_ids: ["T1-S1"] }],
	] as Array<[string, Record<string, unknown>]>)(
		"rejects %s results across branch replay even when task content matches",
		async (name, params) => {
			const h = await harness();
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			h.registry.classify = async (...args) => {
				entered.resolve();
				await release.promise;
				return h.classify(...args);
			};
			const pending = h.call(name, params);
			await entered.promise;
			h.store.replay(h.ctx.sessionManager.getBranch());
			const before = structuredClone(h.store.getState());
			release.resolve();
			expect((await pending).isError).toBe(true);
			expect(h.store.getState()).toEqual(before);
			expect(h.events).toHaveLength(1);
		},
	);

	it("rejects a later unsupported batch entry atomically and preserves retry IDs", async () => {
		const h = await harness();
		const classify = h.classify;
		let calls = 0;
		h.registry.classify = async (...args) => {
			const result = await classify(...args);
			calls += 1;
			if (calls === 2)
				result.answers.passing_evidence_supported = {
					type: "bool",
					probability: 0.01,
				};
			return result;
		};
		const params = {
			entries: [
				{ ...proof, operation: "record", passed: "true" },
				{
					...proof,
					summary: "Parser compatibility suite passed",
					operation: "verify_step",
					step_id: "T1-S1",
					passed: "true",
				},
			],
		};
		const rejected = await h.call("task_evidence_batch", params);
		expect(rejected.isError).toBe(true);
		expect(h.events).toHaveLength(1);
		expect(h.store.getState().tasks.T1?.evidence).toHaveLength(0);
		h.registry.classify = classify;
		expect((await h.call("task_evidence_batch", params)).isError).not.toBe(
			true,
		);
		expect(
			h.store.getState().tasks.T1?.evidence.map((item) => item.id),
		).toEqual(["E1", "E2"]);
		expect(h.store.getState().tasks.T1?.planSteps[0]?.status).toBe("done");
	});
});
