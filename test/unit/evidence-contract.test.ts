import { describe, expect, it } from "vitest";
import { evidenceContract } from "../../src/evidence-contract.ts";
import { TASK_EVENT_CUSTOM_TYPE, type TaskEvent } from "../../src/model.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../../src/pi-types.ts";
import { reduceTaskState } from "../../src/reducer.ts";
import {
	EVIDENCE_PROMPT_VERSION,
	type EvidenceAssessmentInput,
	hashEvidenceAssessmentInput,
} from "../../src/semantic-assessment.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";
import { registerTaskTools } from "../../src/tools.ts";
import { evidenceCases } from "../fixtures/semantic-evidence.ts";
import { assertSchema } from "./assert-schema.ts";
import { evidenceAssessment, fakeSemanticRuntime } from "./semantic-fixture.ts";

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing fixture");
	return value;
}

async function harness(input: EvidenceAssessmentInput, supported = true) {
	const contract = required(input.contract);
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const events: TaskEvent[] = [];
	const inputs: EvidenceAssessmentInput[] = [];
	let publications = 0;
	const store = createTaskRuntimeStore();
	const runtime = fakeSemanticRuntime();
	const classify = required(runtime.modelRegistry?.classify);
	const ctx: ExtensionContext = {
		...runtime,
		modelRegistry: {
			...runtime.modelRegistry,
			async classify(model, context, options) {
				if (context.state.untrustedEvidenceData) {
					inputs.push(
						structuredClone(
							context.state.untrustedEvidenceData as EvidenceAssessmentInput,
						),
					);
					return {
						provider: "test",
						model: "contract-transport-fixture",
						stopReason: "stop",
						timestamp: Date.now(),
						answers: {
							passing_evidence_supported: {
								type: "bool",
								probability: supported ? 0.95 : 0.05,
							},
						},
					};
				}
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
		appendEntry: (_type, event) => events.push(event as TaskEvent),
		events: {
			emit: () => {
				publications++;
			},
		},
	};
	registerTaskTools(pi, store);
	const call = (name: string, params: Record<string, unknown>) => {
		const tool = required(tools.get(name));
		assertSchema(tool.parameters, params);
		return tool.execute("call", params, undefined, undefined, ctx);
	};
	const planned = await call("task_plan", {
		title: "Trial reconciliation",
		objective: contract.objective,
		acceptance_criteria: [
			required(contract.criteria[0]).text,
			"Unrelated implementation must succeed",
		],
		plan_steps: [
			{
				...required(contract.steps[0]),
				criterionRefs: [1],
				allowedActions: [
					"Inspect retained artifacts and report the observed outcome",
				],
			},
			{
				text: "Repair unrelated implementation",
				expectedOutput: "Working unrelated implementation",
				criterionRefs: [2],
				allowedActions: ["Edit and test the unrelated implementation"],
			},
		].map(({ id: _id, ...step }) => step),
	});
	expect(planned.isError).not.toBe(true);
	return { call, store, events, inputs, publications: () => publications };
}

function params(input: EvidenceAssessmentInput) {
	const { contract, ...evidence } = input;
	return {
		task_id: "T1",
		...evidence,
		passed: "true",
		role: contract?.role ?? "acceptance",
		criterion_ids: ["T1-AC1"],
	};
}

// These tests validate transport/persistence with controlled judgments, not model accuracy.
describe("persisted evidence contracts", () => {
	it.each(["task_evidence", "task_verify_step", "task_evidence_batch"])(
		"binds %s to persisted targets and replays without inference",
		async (route) => {
			const fixture = required(evidenceCases[0]);
			const h = await harness(fixture.input);
			const p = params(fixture.input);
			const before = structuredClone(h.store.getState());
			const { task_id: _task, ...entry } = p;
			const { passed: _passed, role: _role, ...verification } = p;
			const result = await h.call(
				route,
				route === "task_evidence_batch"
					? {
							task_id: "T1",
							entries: [
								{ ...entry, operation: "verify_step", step_id: "T1-S1" },
							],
						}
					: route === "task_verify_step"
						? { ...verification, step_id: "T1-S1" }
						: { ...p, step_ids: ["T1-S1"] },
			);
			expect(result.isError).not.toBe(true);
			expect(h.inputs[0]?.contract).toEqual(fixture.input.contract);
			const task = required(h.store.getState().tasks.T1);
			const evidence = required(task.evidence[0]);
			expect(evidence.semanticAssessment?.contractVersion).toBe(1);
			expect(evidence.semanticAssessment?.provenance.promptVersion).toBe(
				EVIDENCE_PROMPT_VERSION,
			);
			expect(evidence.semanticAssessment?.inputHash).toBe(
				hashEvidenceAssessmentInput(required(h.inputs[0])),
			);
			expect(task.acceptanceCriteria.map((c) => c.status)).toEqual([
				"satisfied",
				"pending",
			]);
			expect(task.planSteps[1]?.evidenceIds).toEqual([]);
			const count = h.inputs.length;
			const replayed = createTaskRuntimeStore().replay(
				h.events.map((data) => ({
					type: "custom",
					customType: TASK_EVENT_CUSTOM_TYPE,
					data,
				})),
			);
			expect(replayed.malformedEvents).toEqual([]);
			expect(replayed.state).toEqual(h.store.getState());
			expect(h.inputs).toHaveLength(count);
			const event = required(h.events.at(-1));
			for (const change of ["objective", "step", "criterion"] as const) {
				const stale = structuredClone(before);
				const target = required(stale.tasks.T1);
				if (change === "objective") target.objective = "Different task outcome";
				if (change === "step")
					required(target.planSteps[0]).expectedOutput =
						"Implementation must succeed";
				if (change === "criterion")
					required(target.acceptanceCriteria[0]).text =
						"A successful paid rerun";
				expect(() => reduceTaskState(stale, event)).toThrow(/input hash/);
			}
			for (const change of ["step-link", "criterion-link"] as const) {
				const changed = structuredClone(event);
				const entry =
					changed.type === "task.evidence_batch"
						? required(changed.entries[0])
						: changed;
				if (
					entry.type !== "task.evidence_added" &&
					entry.type !== "task.step_verified"
				)
					throw new Error("Expected evidence event");
				if (change === "criterion-link") entry.criterionIds = ["T1-AC2"];
				else if (entry.type === "task.step_verified") entry.stepId = "T1-S2";
				else entry.stepIds = ["T1-S2"];
				expect(() => reduceTaskState(before, changed)).toThrow(/input hash/);
			}
		},
	);

	it.each(evidenceCases)(
		"transports the paired $id judgment without laundering criteria",
		async (fixture) => {
			const h = await harness(fixture.input, fixture.expected === "supported");
			const before = structuredClone(h.store.getState());
			const published = h.publications();
			const result = await h.call("task_evidence", {
				...params(fixture.input),
				step_ids: ["T1-S1"],
			});
			expect(h.inputs[0]?.contract).toEqual(fixture.input.contract);
			if (fixture.expected === "unsupported") {
				expect(result.isError).toBe(true);
				expect(result.content[0]?.text).toContain("Unsupported claim:");
				expect(result.content[0]?.text).toContain(
					"Missing or contradicting observation:",
				);
				expect(result.content[0]?.text).toContain(
					"do not replay a consumed paid operation",
				);
				expect(h.store.getState()).toEqual(before);
				expect(h.events).toHaveLength(1);
				expect(h.publications()).toBe(published);
			} else {
				expect(result.isError).not.toBe(true);
				expect(h.store.getState().tasks.T1?.acceptanceCriteria[0]?.status).toBe(
					fixture.input.contract?.role === "diagnostic"
						? "pending"
						: "satisfied",
				);
			}
		},
	);

	it("rejects an invalid batch atomically and retains earlier failed evidence", async () => {
		const fixture = required(evidenceCases[1]);
		const h = await harness(fixture.input, false);
		const { passed: _passed, ...p } = params(fixture.input);
		await h.call("task_evidence", {
			...p,
			passed: "false",
			criterion_ids: ["T1-AC2"],
			override_reason: "Retain unrelated implementation failure",
		});
		const before = structuredClone(h.store.getState());
		const { task_id: _task, ...entry } = p;
		const result = await h.call("task_evidence_batch", {
			task_id: "T1",
			entries: [
				{ ...entry, passed: "false", operation: "record" },
				{
					...entry,
					passed: "true",
					operation: "verify_step",
					step_id: "T1-S1",
				},
			],
		});
		expect(result.isError).toBe(true);
		expect(h.store.getState()).toEqual(before);
		expect(h.events).toHaveLength(2);
		expect(h.store.getState().tasks.T1?.acceptanceCriteria[1]?.status).toBe(
			"failed",
		);
	});

	it("reporting success does not erase unrelated implementation failure", async () => {
		const fixture = required(evidenceCases[0]);
		const h = await harness(fixture.input);
		await h.call("task_evidence", {
			...params(fixture.input),
			passed: "false",
			criterion_ids: ["T1-AC2"],
			override_reason: "Retain unresolved implementation failure",
		});
		const failedId = h.store.getState().tasks.T1?.evidence[0]?.id;
		expect(
			(await h.call("task_evidence", params(fixture.input))).isError,
		).not.toBe(true);
		const task = required(h.store.getState().tasks.T1);
		expect(task.acceptanceCriteria.map((c) => c.status)).toEqual([
			"satisfied",
			"failed",
		]);
		expect(task.acceptanceCriteria[1]?.evidenceIds).toEqual([failedId]);
		expect(task.evidence[0]?.passed).toBe(false);
		expect(task.evidence[1]?.supersedesEvidenceIds).toEqual([]);
	});

	it("rejects reporting proof reused to complete an implementation step or criterion", async () => {
		const h = await harness(required(evidenceCases[0]).input);
		expect(
			(
				await h.call("task_evidence", {
					...params(required(evidenceCases[0]).input),
					step_ids: ["T1-S1"],
				})
			).isError,
		).not.toBe(true);
		const evidenceId = required(h.store.getState().tasks.T1?.evidence[0]?.id);
		expect(
			(
				await h.call("task_update", {
					task_id: "T1",
					step_id: "T1-S1",
					step_status: "done",
					step_evidence_ids: [evidenceId],
				})
			).isError,
		).not.toBe(true);
		const beforeStep = structuredClone(h.store.getState());
		const step = await h.call("task_update", {
			task_id: "T1",
			step_id: "T1-S2",
			step_status: "done",
			step_evidence_ids: [evidenceId],
		});
		expect(step.isError).toBe(true);
		expect(step.content[0]?.text).toContain("assessed for its output");
		expect(h.store.getState()).toEqual(beforeStep);
		await h.call("task_update", {
			task_id: "T1",
			step_id: "T1-S2",
			step_status: "skipped",
			reason: "Exercise criterion-only rebinding rejection",
		});
		const beforeComplete = structuredClone(h.store.getState());
		const complete = await h.call("task_complete", {
			task_id: "T1",
			summary: "Implementation succeeded",
			evidence_ids: [evidenceId],
			criterion_results: [
				{
					criterionId: "T1-AC2",
					status: "satisfied",
					evidenceIds: [evidenceId],
				},
			],
		});
		expect(complete.isError).toBe(true);
		expect(complete.content[0]?.text).toContain(
			"without active acceptance evidence",
		);
		expect(h.store.getState()).toEqual(beforeComplete);
	});

	it("keeps supported diagnostics visible without using them as step-completion proof", async () => {
		const fixture = required(
			evidenceCases.find((c) => c.id === "diagnostic-not-implementation"),
		);
		const h = await harness(fixture.input);
		await h.call("task_evidence", {
			...params(fixture.input),
			step_ids: ["T1-S1"],
		});
		const before = structuredClone(h.store.getState());
		const evidenceId = required(before.tasks.T1?.evidence[0]?.id);
		const result = await h.call("task_update", {
			task_id: "T1",
			step_id: "T1-S1",
			step_status: "done",
			step_evidence_ids: [evidenceId],
		});
		expect(result.isError).toBe(true);
		expect(h.store.getState()).toEqual(before);
	});

	it("retains immutable proof targets when a new association is explicitly reassessed", async () => {
		const fixture = required(evidenceCases[0]);
		const h = await harness(fixture.input);
		await h.call("task_evidence", {
			...params(fixture.input),
			step_ids: ["T1-S1"],
		});
		// Controlled supported judgment tests reassociation persistence, not model accuracy.
		const result = await h.call("task_evidence", {
			...params(fixture.input),
			criterion_ids: ["T1-AC2"],
			step_ids: ["T1-S2"],
			override_reason: "Explicit reassessment for another target",
		});
		expect(result.isError).not.toBe(true);
		const records = required(h.store.getState().tasks.T1).evidence;
		expect(records).toHaveLength(2);
		expect(records[0]?.assessedContract?.criteria.map((c) => c.id)).toEqual([
			"T1-AC1",
		]);
		expect(records[1]?.assessedContract?.criteria.map((c) => c.id)).toEqual([
			"T1-AC2",
		]);
		expect(records[0]?.id).not.toBe(records[1]?.id);
		for (const [index, stepId] of ["T1-S1", "T1-S2"].entries()) {
			expect(
				(
					await h.call("task_update", {
						task_id: "T1",
						step_id: stepId,
						step_status: "done",
						step_evidence_ids: [required(records[index]).id],
					})
				).isError,
			).not.toBe(true);
		}
		expect(
			(
				await h.call("task_complete", {
					task_id: "T1",
					summary: "All explicitly assessed targets completed",
					evidence_ids: records.map((r) => r.id),
				})
			).isError,
		).not.toBe(true);
	});

	it.each([
		"task_evidence",
		"task_verify_step",
		"batch-record",
		"batch-verify",
	])(
		"keeps cross-target reassessment and same-contract retry addressable through %s",
		async (route) => {
			const fixture = required(evidenceCases[0]);
			const h = await harness(fixture.input);
			await h.call("task_evidence", {
				...params(fixture.input),
				step_ids: ["T1-S1"],
			});
			const originalId = required(h.store.getState().tasks.T1?.evidence[0]?.id);
			await h.call("task_update", {
				task_id: "T1",
				step_id: "T1-S1",
				step_status: "done",
				step_evidence_ids: [originalId],
			});
			const p = { ...params(fixture.input), criterion_ids: ["T1-AC2"] };
			const { task_id: _task, ...entry } = p;
			const {
				passed: _pass,
				role: _role,
				criterion_ids: _criteria,
				...verification
			} = p;
			const name = route.startsWith("batch") ? "task_evidence_batch" : route;
			const request =
				route === "batch-record"
					? {
							task_id: "T1",
							entries: [{ ...entry, operation: "record", step_ids: ["T1-S2"] }],
						}
					: route === "batch-verify"
						? {
								task_id: "T1",
								entries: [
									{ ...entry, operation: "verify_step", step_id: "T1-S2" },
								],
							}
						: route === "task_verify_step"
							? { ...verification, step_id: "T1-S2" }
							: { ...p, step_ids: ["T1-S2"] };
			// Controlled assessor approval establishes identity handling, not semantic truth.
			const first = await h.call(name, request);
			expect(first.isError, JSON.stringify(first.content)).not.toBe(true);
			const records = required(h.store.getState().tasks.T1).evidence;
			expect(records).toHaveLength(2);
			expect(records[1]?.id).not.toBe(originalId);
			expect(records[1]?.assessedContract?.steps[0]?.id).toBe("T1-S2");
			expect(records[1]?.assessedContract?.criteria[0]?.id).toBe("T1-AC2");
			expect(h.inputs).toHaveLength(2);
			expect((await h.call(name, request)).isError).not.toBe(true);
			expect(h.store.getState().tasks.T1?.evidence).toHaveLength(2);
		},
	);

	it("does not let active-step attachment masquerade as reassessed proof", async () => {
		const fixture = required(evidenceCases[0]);
		const h = await harness(fixture.input);
		await h.call("task_evidence", {
			...params(fixture.input),
			step_ids: ["T1-S1"],
		});
		const originalId = required(h.store.getState().tasks.T1?.evidence[0]?.id);
		await h.call("task_update", {
			task_id: "T1",
			step_id: "T1-S1",
			step_status: "done",
			step_evidence_ids: [originalId],
		});
		await h.call("task_update", {
			task_id: "T1",
			step_id: "T1-S2",
			step_status: "active",
			step_evidence_ids: [originalId],
		});
		const result = await h.call("task_evidence", {
			...params(fixture.input),
			criterion_ids: [],
			step_ids: ["T1-S2"],
		});
		expect(result.isError).not.toBe(true);
		expect(h.inputs).toHaveLength(2);
		expect(h.store.getState().tasks.T1?.evidence).toHaveLength(2);
		expect(h.store.getState().tasks.T1?.evidence[1]?.id).not.toBe(originalId);
	});

	it("requires fresh proof for the reworked criterion rather than fresh unrelated proof", async () => {
		const fixture = required(evidenceCases[0]);
		const h = await harness(fixture.input);
		for (const index of [1, 2]) {
			await h.call("task_evidence", {
				...params(fixture.input),
				step_ids: [`T1-S${index}`],
				criterion_ids: [`T1-AC${index}`],
			});
			const id = required(h.store.getState().tasks.T1?.evidence[index - 1]?.id);
			await h.call("task_update", {
				task_id: "T1",
				step_id: `T1-S${index}`,
				step_status: "done",
				step_evidence_ids: [id],
			});
		}
		const original = required(h.store.getState().tasks.T1?.evidence[0]?.id);
		expect(
			(
				await h.call("task_rework", {
					task_id: "T1",
					reason: "Report needs refreshed inspection",
					plan_steps: [
						{
							text: "Refresh trial reconciliation report",
							expectedOutput: "A newly inspected reconciliation report",
							criterionIds: ["T1-AC1"],
							allowedActions: [
								"Inspect retained artifacts and update the report",
							],
						},
					],
				})
			).isError,
		).not.toBe(true);
		await h.call("task_evidence", {
			...params(fixture.input),
			summary: "Fresh unrelated proof after rework",
			criterion_ids: ["T1-AC2"],
			step_ids: ["T1-S2"],
			override_reason: "Test unrelated fresh proof remains unrelated",
		});
		const unrelated = required(
			h.store.getState().tasks.T1?.evidence.at(-1)?.id,
		);
		await h.call("task_update", {
			task_id: "T1",
			step_id: "T1-S3",
			step_status: "skipped",
			reason: "Exercise criterion freshness independent of step completion",
		});
		const before = structuredClone(h.store.getState());
		const result = await h.call("task_complete", {
			task_id: "T1",
			summary: "Reworked criterion complete",
			evidence_ids: [original, unrelated],
			criterion_results: [
				{
					criterionId: "T1-AC1",
					status: "satisfied",
					evidenceIds: [original, unrelated],
				},
			],
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("after rework");
		expect(h.store.getState()).toEqual(before);
		expect(
			(
				await h.call("task_evidence", {
					...params(fixture.input),
					summary: "Fresh matching report inspection after rework",
				})
			).isError,
		).not.toBe(true);
		const matching = required(h.store.getState().tasks.T1?.evidence.at(-1)?.id);
		expect(
			(
				await h.call("task_complete", {
					task_id: "T1",
					summary: "Fresh matching criterion proof",
					evidence_ids: [matching, unrelated],
				})
			).isError,
		).not.toBe(true);
	});

	it.each(["task_evidence", "task_evidence_batch"])(
		"keeps model-free failure/unknown records contextual through %s",
		async (route) => {
			for (const passed of ["false", "unknown"]) {
				for (const role of ["diagnostic", "acceptance"]) {
					const fixture = required(evidenceCases[0]);
					const h = await harness(fixture.input);
					const p = {
						...params(fixture.input),
						passed,
						role,
						step_ids: ["T1-S1"],
					};
					const { task_id: _task, ...entry } = p;
					const recorded = await h.call(
						route,
						route === "task_evidence_batch"
							? { task_id: "T1", entries: [{ ...entry, operation: "record" }] }
							: p,
					);
					expect(recorded.isError).not.toBe(true);
					expect(h.inputs).toHaveLength(0);
					const before = structuredClone(h.store.getState());
					const record = required(before.tasks.T1?.evidence[0]);
					expect(record.contractVersion).toBe(1);
					expect(record.semanticAssessment).toBeUndefined();
					const result = await h.call("task_update", {
						task_id: "T1",
						step_id: "T1-S1",
						step_status: "done",
						step_evidence_ids: [record.id],
					});
					expect(result.isError).toBe(true);
					expect(result.content[0]?.text).toContain(
						"requires passing acceptance evidence",
					);
					expect(h.store.getState()).toEqual(before);
					if (role === "diagnostic") {
						await h.call("task_evidence", {
							...params(fixture.input),
							step_ids: ["T1-S1"],
						});
						const acceptanceId = required(
							h.store.getState().tasks.T1?.evidence[1]?.id,
						);
						expect(
							(
								await h.call("task_update", {
									task_id: "T1",
									step_id: "T1-S1",
									step_status: "done",
									step_evidence_ids: [acceptanceId],
								})
							).isError,
						).not.toBe(true);
						expect(h.store.getState().tasks.T1?.evidence[0]?.role).toBe(
							"diagnostic",
						);
					}
				}
			}
		},
	);

	it("uses default verify-step criteria rather than evidence-provided prose", async () => {
		const fixture = required(evidenceCases[0]);
		const h = await harness(fixture.input);
		const {
			passed: _passed,
			role: _role,
			criterion_ids: _criteria,
			...p
		} = params(fixture.input);
		expect(
			(await h.call("task_verify_step", { ...p, step_id: "T1-S1" })).isError,
		).not.toBe(true);
		expect(h.inputs[0]?.contract).toEqual(fixture.input.contract);
	});

	it("uses only selected criteria, mirrors implicit matching, and refuses clipped contract meaning", async () => {
		const h = await harness(required(evidenceCases[0]).input);
		const task = required(h.store.getState().tasks.T1);
		const selected = evidenceContract(task, { criterionIds: ["T1-AC1"] });
		expect(selected.steps.map((s) => s.id)).toEqual(["T1-S1"]);
		expect(selected.criteria.map((c) => c.id)).toEqual(["T1-AC1"]);
		expect(evidenceContract(task, {}).steps).toEqual([]);
		expect(() => evidenceContract(task, { stepIds: ["absent"] })).toThrow(
			/not found/,
		);
		required(task.planSteps[0]).expectedOutput = "x".repeat(65_537);
		expect(() => evidenceContract(task, { stepIds: ["T1-S1"] })).toThrow(
			/exceeds/,
		);
	});

	it("keeps pre-contract assessment hashes replayable", async () => {
		const fixture = required(evidenceCases[0]);
		const h = await harness(fixture.input);
		const { contract: _contract, ...legacy } = fixture.input;
		const event: TaskEvent = {
			id: "legacy-event",
			source: "tool",
			version: 2,
			type: "task.evidence_added",
			taskId: "T1",
			createdAt: "2026-11-07T00:00:00.000Z",
			evidence: {
				id: "legacy-E1",
				type: "review",
				level: "static_read",
				summary: legacy.summary,
				passed: true,
				references: legacy.references,
				quality: { ...legacy.quality, verifier: "agent" },
			},
			semanticAssessment: evidenceAssessment(legacy),
			stepIds: ["T1-S1"],
			criterionIds: ["T1-AC1"],
		};
		expect(() => reduceTaskState(h.store.getState(), event)).not.toThrow();
	});
});
