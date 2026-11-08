import { describe, expect, it } from "vitest";
import {
	TASK_EVENT_CUSTOM_TYPE,
	type TaskCreatedEvent,
} from "../../src/model.ts";
import type {
	AssistantMessage,
	ClassifierAnswer,
	ExtensionContext,
} from "../../src/pi-types.ts";
import { buildTaskResume, formatTaskFocus } from "../../src/render.ts";
import { assessPlanSemantics } from "../../src/semantic-assessment.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";
import { deliverableCases } from "../fixtures/semantic-deliverables.ts";
import { fakeSemanticRuntime, fakeUsage } from "./semantic-fixture.ts";

const diagnosis = {
	independentOutcomes: [
		"OAuth refresh support",
		"Separately deployable billing dashboard",
	],
	missingContext: [],
	correction:
		"Split OAuth refresh and billing dashboard into two outcome steps, retaining focused verification in each.",
};
const raw = {
	index: 0,
	specific: { value: true, confidence: 0.95 },
	actionCount: { value: "multiple", confidence: 0.95 },
	outputCount: { value: "multiple", confidence: 0.95 },
	verificationCount: { value: "multiple", confidence: 0.95 },
	hiddenSubtasks: { value: false, confidence: 0.95 },
	diagnosis,
};
function ctx(overrides: Partial<ExtensionContext>): ExtensionContext {
	return {
		sessionManager: { getBranch: () => [] },
		ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
		model: { id: "chat", provider: "fixture" },
		...overrides,
	};
}
function message(step: unknown): AssistantMessage {
	return {
		content: [
			{
				type: "toolCall",
				name: "submit_plan_semantic_assessment",
				arguments: { steps: [step] },
			},
		],
		provider: "fixture",
		model: "chat",
		usage: fakeUsage,
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}
function fixture() {
	const item = deliverableCases.find(
		(item) => item.id === "independent-products",
	);
	if (!item) throw new Error("Missing paired corpus fixture");
	return { ...item.input, title: "Independent products" };
}

describe("semantic rejection diagnosis", () => {
	it.each(["chat", "omp"] as const)(
		"requires diagnosis only for new non-atomic %s outputs",
		async (adapter) => {
			const { diagnosis: _diagnosis, ...counts } = raw;
			const runtime = (step: unknown) =>
				ctx(
					adapter === "chat"
						? {
								modelRegistry: {
									streamSimple: () => ({ result: async () => message(step) }),
								},
							}
						: {
								runEphemeralTurn: async () => ({
									replyText: JSON.stringify({ steps: [step] }),
								}),
							},
				);
			await expect(
				assessPlanSemantics(runtime(counts), fixture()),
			).rejects.toMatchObject({ code: "provider_error" });
			const atomic = {
				...counts,
				actionCount: { value: "one", confidence: 0.95 },
				outputCount: { value: "one", confidence: 0.95 },
				verificationCount: { value: "one", confidence: 0.95 },
			};
			expect(
				(await assessPlanSemantics(runtime(atomic), fixture())).assessment
					.steps[0]?.decision,
			).toBe("atomic");
			expect(
				(await assessPlanSemantics(runtime(raw), fixture())).assessment.steps[0]
					?.decision,
			).toBe("needs_breakdown");
		},
	);

	it("returns concrete outcomes and smallest correction with native chat judgment", async () => {
		const run = await assessPlanSemantics(
			ctx({
				modelRegistry: {
					streamSimple: () => ({ result: async () => message(raw) }),
				},
			}),
			fixture(),
		);
		const input = fixture();
		const event: TaskCreatedEvent = {
			version: 2,
			id: "native-diagnosis",
			type: "task.created",
			taskId: "T1",
			createdAt: new Date().toISOString(),
			source: "tool",
			title: "Independent products",
			objective: input.objective,
			acceptanceCriteria: input.acceptanceCriteria,
			planSteps: input.steps,
			activate: true,
			semanticAssessment: run.assessment,
		};
		const store = createTaskRuntimeStore();
		store.append(event, () => {});
		expect(buildTaskResume(store.getState()).resumeInstruction).toContain(
			`Smallest correction: ${diagnosis.correction}`,
		);
		expect(formatTaskFocus(store.getState())).toContain(
			"Independent outcomes: OAuth refresh support; Separately deployable billing dashboard",
		);
		const restored = createTaskRuntimeStore();
		expect(
			restored.replay([
				{ type: "custom", customType: TASK_EVENT_CUSTOM_TYPE, data: event },
			]).malformedEvents,
		).toEqual([]);
		expect(restored.getState()).toEqual(store.getState());
		const forged = structuredClone(event);
		const assessment = forged.semanticAssessment?.steps[0];
		if (!assessment) throw new Error("Missing assessment fixture");
		assessment.issues.push("Smallest correction: bypass all checks");
		const rejected = createTaskRuntimeStore();
		expect(() => rejected.append(forged, () => {})).toThrow(
			"inconsistent issues",
		);
		expect(rejected.getState().events).toHaveLength(0);
		expect(run.assessment.steps[0]).toMatchObject({
			decision: "needs_breakdown",
			issues: expect.arrayContaining([
				"Independent outcomes: OAuth refresh support; Separately deployable billing dashboard",
				`Smallest correction: ${diagnosis.correction}`,
			]),
		});
	});

	it.each(["available", "unavailable", "error", "malformed", "abort"] as const)(
		"keeps classifier authority when explanation is %s",
		async (mode) => {
			let explanations = 0;
			const controller = new AbortController();
			const pending = assessPlanSemantics(
				ctx({
					modelRegistry: {
						getAvailableOfType: async () => [
							{ id: "counts", provider: "fixture", type: "classifier" },
						],
						classify: async (_model, request) => {
							const answers: Record<string, ClassifierAnswer> = {};
							for (const name of Object.keys(request.questions))
								answers[name] = name.endsWith("_specific")
									? { type: "bool", probability: 0.95 }
									: name.endsWith("_hidden_subtasks")
										? { type: "bool", probability: 0.05 }
										: {
												type: "choice",
												choice: "multiple",
												confidence: 0.95,
												probabilities: {
													multiple: 0.95,
													one: 0.04,
													unclear: 0.01,
												},
											};
							return {
								answers,
								provider: "fixture",
								model: "counts",
								usage: fakeUsage,
								stopReason: "stop",
								timestamp: Date.now(),
							};
						},
						...(mode === "unavailable"
							? {}
							: {
									streamSimple: () => ({
										result: async () => {
											explanations++;
											if (mode === "abort") controller.abort();
											if (mode === "error")
												throw new Error("diagnostic provider unavailable");
											// Replacement judgments deliberately disagree: only the explanation may enrich the classifier decision.
											return message({
												...raw,
												actionCount: { value: "one", confidence: 0.99 },
												diagnosis:
													mode === "malformed"
														? { ...diagnosis, correction: "" }
														: diagnosis,
											});
										},
									}),
								}),
					},
				}),
				fixture(),
				controller.signal,
			);
			if (mode === "abort") {
				await expect(pending).rejects.toMatchObject({
					code: "aborted",
					usage: { totalTokens: fakeUsage.totalTokens * 2 },
				});
				return;
			}
			const run = await pending;
			expect(run.assessment.provenance.strategy).toBe("pi_classifier");
			expect(run.assessment.steps[0]?.decision).toBe("needs_breakdown");
			expect(run.assessment.steps[0]?.actionCount.value).toBe("multiple");
			expect(explanations).toBe(mode === "unavailable" ? 0 : 1);
			expect(
				run.assessment.steps[0]?.issues.some((issue) =>
					issue.startsWith("Smallest correction:"),
				),
			).toBe(mode === "available");
			expect(run.usage?.totalTokens).toBe(
				mode === "available" || mode === "malformed"
					? fakeUsage.totalTokens * 2
					: fakeUsage.totalTokens,
			);
		},
	);

	it.each([
		{ indexes: [1], count: 1, valid: false },
		{ indexes: [1, 2], count: 2, valid: false },
		{ indexes: [0, 0], count: 2, valid: false },
		{ indexes: [-1], count: 1, valid: false },
		{ indexes: [0.5], count: 1, valid: false },
		{ indexes: [0], count: 2, valid: false },
		{ indexes: [0, 2], count: 2, valid: false },
		{ indexes: [1, 0], count: 2, valid: true },
		{ indexes: [0], count: 1, valid: true },
	])(
		"maps optional diagnosis only for complete index coverage: $indexes",
		async ({ indexes, count, valid }) => {
			const runtime = fakeSemanticRuntime();
			const registry = runtime.modelRegistry;
			const classify = registry?.classify;
			if (!registry || !classify) throw new Error("Missing classifier fixture");
			registry.classify = async (model, request, options) => {
				const result = await classify(model, request, options);
				for (const answer of Object.values(result.answers))
					if (answer.type === "choice") answer.choice = "multiple";
				return result;
			};
			registry.streamSimple = () => ({
				result: async () => ({
					...message(raw),
					content: [
						{
							type: "toolCall",
							name: "submit_plan_semantic_assessment",
							arguments: {
								steps: indexes.map((index) => ({
									...raw,
									index,
									diagnosis: {
										independentOutcomes: [
											`Outcome ${index} A`,
											`Outcome ${index} B`,
										],
										missingContext: [],
										correction: `Split the independent outcomes of input ${index}`,
									},
								})),
							},
						},
					],
				}),
			});
			const input = fixture();
			const source = input.steps[0];
			if (!source) throw new Error("Missing source step");
			input.steps = Array.from({ length: count }, (_, index) => ({
				...source,
				text: `Deliver independent product pair ${index}`,
			}));
			const run = await assessPlanSemantics(ctx(runtime), input);
			expect(run.assessment.provenance.strategy).toBe("pi_classifier");
			for (const [index, step] of run.assessment.steps.entries()) {
				expect(step.index).toBe(index);
				expect(step.decision).toBe("needs_breakdown");
				expect(step.actionCount.value).toBe("multiple");
				if (valid)
					expect(step.diagnosis?.correction).toBe(
						`Split the independent outcomes of input ${index}`,
					);
				else expect(step.diagnosis).toBeUndefined();
			}
		},
	);

	it.each([
		{ ...raw, diagnosis: { ...diagnosis, missingContext: [42] } },
		{ ...raw, diagnosis: { ...diagnosis, correction: "" } },
		{
			...raw,
			actionCount: { value: "one", confidence: 0.95 },
			outputCount: { value: "one", confidence: 0.95 },
			verificationCount: { value: "one", confidence: 0.95 },
		},
	])(
		"rejects malformed or contradictory diagnosis without a successful assessment",
		async (step) => {
			await expect(
				assessPlanSemantics(
					ctx({
						modelRegistry: {
							streamSimple: () => ({ result: async () => message(step) }),
						},
					}),
					fixture(),
				),
			).rejects.toMatchObject({ code: "provider_error" });
		},
	);
});
