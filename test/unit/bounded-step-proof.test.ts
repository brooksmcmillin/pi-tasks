import { describe, expect, it } from "vitest";
import { evidenceContract } from "../../src/evidence-contract.ts";
import { TASK_EVENT_CUSTOM_TYPE, type TaskEvent } from "../../src/model.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../../src/pi-types.ts";
import { reduceTaskState } from "../../src/reducer.ts";
import type { EvidenceAssessmentInput } from "../../src/semantic-assessment.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";
import { registerTaskTools } from "../../src/tools.ts";
import {
	boundedObjective,
	boundedObservation,
	boundedStep,
	finalCriterion,
} from "../fixtures/bounded-step-evidence.ts";
import { legacyCriterionProof } from "../fixtures/legacy-criterion-proof.ts";
import { assertSchema } from "./assert-schema.ts";
import { evidenceAssessment, fakeSemanticRuntime } from "./semantic-fixture.ts";

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing fixture");
	return value;
}

async function harness(uniqueCriterion = false) {
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const events: TaskEvent[] = [];
	const inputs: EvidenceAssessmentInput[] = [];
	const store = createTaskRuntimeStore();
	const runtime = fakeSemanticRuntime();
	const classify = required(runtime.modelRegistry?.classify);
	let supported = true;
	let publications = 0;
	const ctx: ExtensionContext = {
		...runtime,
		modelRegistry: {
			...runtime.modelRegistry,
			async classify(model, context, options) {
				if (!context.state.untrustedEvidenceData)
					return classify(model, context, options);
				inputs.push(
					structuredClone(
						context.state.untrustedEvidenceData as EvidenceAssessmentInput,
					),
				);
				return {
					provider: "test",
					model: "controlled-target-judgment",
					stopReason: "stop",
					timestamp: Date.now(),
					answers: {
						passing_evidence_supported: {
							type: "bool",
							probability: supported ? 0.95 : 0.05,
						},
					},
				};
			},
		},
		sessionManager: { getBranch: () => [] },
		ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
	};
	const pi: ExtensionAPI = {
		on: () => {},
		registerCommand: () => {},
		registerTool: (tool) => tools.set(tool.name, tool),
		appendEntry: (_type, event) => events.push(event as TaskEvent),
		events: {
			emit: () => {
				publications++;
			},
		},
	};
	registerTaskTools(pi, store);
	const call = (name: string, params: Record<string, unknown>) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(name);
		assertSchema(tool.parameters, params);
		return tool.execute("call", params, undefined, undefined, ctx);
	};
	const planned = await call("task_plan", {
		title: "Bounded fixtures then final PR gate",
		objective: boundedObjective,
		acceptance_criteria: [
			finalCriterion.text,
			...(uniqueCriterion ? ["Separate review obligation"] : []),
		],
		plan_steps: [
			{
				text: boundedStep.text,
				expectedOutput: boundedStep.expectedOutput,
				criterionRefs: [1],
				allowedActions: ["Add and verify focused fixtures"],
			},
			{
				text: "Disposition findings and verify the published head",
				expectedOutput: finalCriterion.text,
				criterionRefs: [uniqueCriterion ? 2 : 1],
				allowedActions: [
					"Inspect findings, checks and independent review for the fixed head",
				],
			},
		],
	});
	expect(planned.isError).not.toBe(true);
	return {
		call,
		store,
		task: () => required(store.getState().tasks.T1),
		events,
		inputs,
		setSupported: (value: boolean) => {
			supported = value;
		},
		publications: () => publications,
	};
}

const { contract: _contract, ...observations } = boundedObservation;
const verification = { task_id: "T1", step_id: "T1-S1", ...observations };
const finalObservations = {
	...observations,
	type: "review",
	level: "static_read",
	summary:
		"Published head abc123 has all findings dispositioned, passing checks and a clean independent review.",
	quality: {
		...observations.quality,
		observedOutput:
			"Findings ledger lists 0 unresolved findings; checks and independent review both pass on published head abc123.",
	},
};

// Controlled judgments prove registered-route behavior, not model accuracy.
describe("bounded step proof versus final acceptance", () => {
	it.each(["single", "batch", "empty-selection"])(
		"advances %s step proof without final acceptance, including retry and resume",
		async (route) => {
			const h = await harness();
			const name =
				route === "batch" ? "task_evidence_batch" : "task_verify_step";
			const params =
				route === "batch"
					? {
							task_id: "T1",
							entries: [
								{
									...observations,
									step_id: "T1-S1",
									operation: "verify_step",
									passed: "true",
								},
							],
						}
					: {
							...verification,
							...(route === "empty-selection" ? { criterion_ids: [] } : {}),
						};
			const result = await h.call(name, params);
			expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
			const task = h.task();
			expect(task.planSteps.map((s) => s.status)).toEqual(["done", "active"]);
			expect(task.acceptanceCriteria[0]?.status).toBe("pending");
			expect(task.acceptanceCriteria[0]?.evidenceIds).toEqual([]);
			expect(task.evidence[0]?.assessedContract).toEqual(
				boundedObservation.contract,
			);
			expect(task.evidence[0]?.contractVersion).toBe(2);
			expect((await h.call(name, params)).isError).not.toBe(true);
			expect(h.store.getState().tasks.T1?.evidence).toHaveLength(1);
			const saved = structuredClone(h.events);
			const replay = createTaskRuntimeStore();
			const restored = replay.replay(
				saved.map((data) => ({
					type: "custom",
					customType: TASK_EVENT_CUSTOM_TYPE,
					data,
				})),
			);
			expect(restored.malformedEvents).toEqual([]);
			expect(restored.state).toEqual(h.store.getState());
			const resume = await h.call("task_resume", {});
			expect(resume.content[0]?.text).toContain("T1-S2");
			expect(resume.content[0]?.text).toContain("T1-AC1 pending");
			expect(resume.content[0]?.text).not.toContain('"criterion_ids"');
			const premature = await h.call("task_complete", {
				task_id: "T1",
				summary: "Done",
				evidence_ids: [required(task.evidence[0]).id],
			});
			expect(premature.isError).toBe(true);
			expect(h.store.getState().tasks.T1?.status).toBe("active");
			// Even a caller-supplied criterion result cannot relabel step-only proof.
			const laundering = await h.call("task_complete", {
				task_id: "T1",
				summary: "Done",
				evidence_ids: [required(task.evidence[0]).id],
				criterion_results: [
					{
						criterionId: "T1-AC1",
						status: "satisfied",
						evidenceIds: [required(task.evidence[0]).id],
					},
				],
			});
			expect(laundering.isError).toBe(true);
		},
	);

	it.each(["single", "batch"])(
		"explicit %s final-criterion claims still require final proof and reject atomically",
		async (route) => {
			const h = await harness();
			h.setSupported(false);
			const before = structuredClone(h.store.getState());
			const published = h.publications();
			const result = await h.call(
				route === "single" ? "task_verify_step" : "task_evidence_batch",
				route === "single"
					? { ...verification, criterion_ids: ["T1-AC1"] }
					: {
							task_id: "T1",
							entries: [
								{
									...observations,
									operation: "verify_step",
									step_id: "T1-S1",
									passed: "true",
									criterion_ids: ["T1-AC1"],
								},
							],
						},
			);
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("Unsupported claim:");
			expect(h.inputs[0]?.contract?.criteria).toEqual([finalCriterion]);
			expect(h.store.getState()).toEqual(before);
			expect(h.publications()).toBe(published);
		},
	);

	it.each(["unsupported", "contradictory", "references-only"])(
		"rejects %s step proof without recording or advancing",
		async (kind) => {
			const h = await harness();
			h.setSupported(false);
			const before = structuredClone(h.store.getState());
			const result = await h.call("task_verify_step", {
				...verification,
				...(kind === "contradictory"
					? {
							quality: {
								...observations.quality,
								observedOutput:
									"11 focused tests failed; fixtures remain broken",
							},
						}
					: {}),
				...(kind === "references-only"
					? {
							quality: {
								...observations.quality,
								observedOutput: "See artifacts/focused-fixtures.log",
							},
						}
					: {}),
			});
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("Unsupported claim:");
			expect(h.store.getState()).toEqual(before);
		},
	);

	it("still rejects task completion when every step is done but acceptance is pending", async () => {
		const h = await harness();
		await h.call("task_verify_step", verification);
		await h.call("task_verify_step", {
			task_id: "T1",
			step_id: "T1-S2",
			...finalObservations,
		});
		expect(h.task().planSteps.every((s) => s.status === "done")).toBe(true);
		const result = await h.call("task_complete", {
			task_id: "T1",
			summary: "Done",
			evidence_ids: h.task().evidence.map((e) => e.id),
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			"Criterion T1-AC1 is not satisfied",
		);
		const laundering = await h.call("task_complete", {
			task_id: "T1",
			summary: "Done",
			evidence_ids: ["E1"],
			criterion_results: [
				{
					criterionId: "T1-AC1",
					status: "satisfied",
					evidenceIds: [required(h.task().evidence[0]).id],
				},
			],
		});
		expect(laundering.isError).toBe(true);
		expect(laundering.content[0]?.text).toContain(
			"without active acceptance evidence",
		);
	});

	it.each([
		"single-unlinked",
		"single-linked",
		"batch-unlinked",
		"batch-linked",
	])(
		"rejects new unknown acceptance as final proof through %s",
		async (route) => {
			const h = await harness();
			await h.call("task_verify_step", verification);
			await h.call("task_verify_step", {
				task_id: "T1",
				step_id: "T1-S2",
				...finalObservations,
			});
			const record = {
				...observations,
				passed: "unknown",
				...(route === "single-linked" || route === "batch-linked"
					? { criterion_ids: ["T1-AC1"] }
					: {}),
			};
			const recorded = await h.call(
				route.startsWith("batch") ? "task_evidence_batch" : "task_evidence",
				route.startsWith("batch")
					? { task_id: "T1", entries: [{ ...record, operation: "record" }] }
					: { task_id: "T1", ...record },
			);
			expect(recorded.isError).not.toBe(true);
			const unknown = required(h.task().evidence.at(-1));
			expect(unknown.passed).toBe("unknown");
			expect(unknown.semanticAssessment).toBeUndefined();
			const before = structuredClone(h.store.getState());
			const result = await h.call("task_complete", {
				task_id: "T1",
				summary: "Unproved final acceptance",
				evidence_ids: h.task().evidence.map((e) => e.id),
				criterion_results: [
					{
						criterionId: "T1-AC1",
						status: "satisfied",
						evidenceIds: [unknown.id],
					},
				],
			});
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain(
				"requires passing acceptance evidence assessed for its meaning",
			);
			expect(h.store.getState()).toEqual(before);
		},
	);

	it("replays a frozen original-hash criterion-only v1 event without inference", async () => {
		const h = await harness(true);
		const old = structuredClone(legacyCriterionProof);
		const state = h.store.append(old, () => {});
		const task = required(state.tasks.T1);
		expect(task.planSteps[0]?.evidenceIds).toEqual(["historical-E1"]);
		expect(task.planSteps[1]?.evidenceIds).toEqual([]);
		expect(task.acceptanceCriteria.map((c) => c.status)).toEqual([
			"satisfied",
			"pending",
		]);
		expect(task.evidence[0]?.semanticAssessment?.inputHash).toBe(
			"c0be75f0fe6e51d976271c71dfdf7e77c0429f2b283403275fed9a24b07d4543",
		);
		expect(task.evidence[0]?.assessedContract?.version).toBe(1);
		expect(task.evidence[0]?.assessedContract?.steps[0]?.id).toBe("T1-S1");
		const replayed = createTaskRuntimeStore().replay(
			[...h.events, old].map((data) => ({
				type: "custom",
				customType: TASK_EVENT_CUSTOM_TYPE,
				data,
			})),
		);
		expect(replayed.malformedEvents).toEqual([]);
		expect(replayed.state).toEqual(state);
		expect(h.inputs).toHaveLength(0);
	});

	it("satisfies the original final criterion later without resubmitting bounded implementation proof", async () => {
		const h = await harness();
		expect((await h.call("task_verify_step", verification)).isError).not.toBe(
			true,
		);
		const first = structuredClone(h.task().evidence[0]);
		expect(
			(
				await h.call("task_evidence", {
					task_id: "T1",
					...finalObservations,
					passed: "true",
					criterion_ids: ["T1-AC1"],
				})
			).isError,
		).not.toBe(true);
		const task = h.task();
		expect(task.acceptanceCriteria[0]?.id).toBe("T1-AC1");
		expect(task.acceptanceCriteria[0]?.status).toBe("satisfied");
		expect(task.evidence[0]).toEqual(first);
		expect(task.evidence[1]?.assessedContract?.steps).toEqual([]);
		expect(task.evidence[1]?.assessedContract?.criteria).toEqual([
			finalCriterion,
		]);
		expect(
			(
				await h.call("task_update", {
					task_id: "T1",
					step_id: "T1-S2",
					step_status: "done",
					step_evidence_ids: [required(task.evidence[1]).id],
				})
			).isError,
		).toBe(true);
		expect(
			(
				await h.call("task_verify_step", {
					task_id: "T1",
					step_id: "T1-S2",
					...finalObservations,
				})
			).isError,
		).not.toBe(true);
		expect(
			(
				await h.call("task_complete", {
					task_id: "T1",
					summary: "Bounded fixtures and final PR gate verified",
					evidence_ids: h.task().evidence.map((e) => e.id),
				})
			).isError,
		).not.toBe(true);
	});

	it("does not require criterion-only proof to support or attach a uniquely linked implementation step", async () => {
		const h = await harness();
		const task = h.task();
		// Only S1 remains linked to the original final gate.
		required(task.planSteps[1]).criterionIds = [];
		expect((await h.call("task_verify_step", verification)).isError).not.toBe(
			true,
		);
		expect(
			(
				await h.call("task_evidence", {
					task_id: "T1",
					...finalObservations,
					passed: "true",
					criterion_ids: ["T1-AC1"],
				})
			).isError,
		).not.toBe(true);
		expect(h.inputs.at(-1)?.contract?.steps).toEqual([]);
		expect(required(h.task().planSteps[0]).evidenceIds).toHaveLength(1);
	});

	it("retains diagnostic history without using it as implementation or criterion proof", async () => {
		const h = await harness();
		expect(
			(
				await h.call("task_evidence", {
					task_id: "T1",
					...observations,
					passed: "true",
					role: "diagnostic",
					step_ids: ["T1-S1"],
					criterion_ids: ["T1-AC1"],
				})
			).isError,
		).not.toBe(true);
		const diagnostic = required(h.task().evidence[0]);
		expect(
			(
				await h.call("task_update", {
					task_id: "T1",
					step_id: "T1-S1",
					step_status: "done",
					step_evidence_ids: [diagnostic.id],
				})
			).isError,
		).toBe(true);
		expect((await h.call("task_verify_step", verification)).isError).not.toBe(
			true,
		);
		expect(h.task().evidence[0]).toEqual(diagnostic);
		expect(required(h.task().acceptanceCriteria[0]).status).toBe("pending");
	});

	it("preserves contract-v1 implicit criteria and criterion-only step inference during replay", async () => {
		const h = await harness();
		const task = h.task();
		required(task.planSteps[1]).criterionIds = [];
		const legacyContract = evidenceContract(
			task,
			{ criterionIds: ["T1-AC1"] },
			1,
		);
		const assessment = evidenceAssessment({
			...observations,
			contract: legacyContract,
		});
		assessment.contractVersion = 1;
		const event: TaskEvent = {
			id: "legacy-proof",
			source: "tool",
			version: 2,
			type: "task.step_verified",
			taskId: "T1",
			stepId: "T1-S1",
			createdAt: "2026-11-10T00:00:00Z",
			evidence: {
				id: "old-E1",
				contractVersion: 1,
				type: "test",
				level: "unit_test",
				summary: observations.summary,
				passed: true,
				references: observations.references,
				quality: { ...observations.quality, verifier: "tool" },
			},
			semanticAssessment: assessment,
		};
		const state = reduceTaskState(h.store.getState(), event);
		expect(required(required(state.tasks.T1).planSteps[0]).status).toBe("done");
		expect(
			required(required(state.tasks.T1).acceptanceCriteria[0]).status,
		).toBe("satisfied");
		expect(
			required(required(state.tasks.T1).evidence[0]).assessedContract,
		).toEqual(legacyContract);
	});
});
