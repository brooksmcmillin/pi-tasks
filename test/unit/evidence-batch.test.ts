import { describe, expect, it } from "vitest";
import { TASK_EVENT_CUSTOM_TYPE, type TaskEvent } from "../../src/model.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../../src/pi-types.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";
import { registerTaskTools } from "../../src/tools.ts";

const check = {
	unit: "deliverable",
	boundedScope: "Parser alias handling only; excludes transport changes",
	verificationPlan:
		"Run the focused parser regression suite for alias handling",
	isAtomic: true,
	reason: "One parser behavior with bounded implementation and tests",
	canBeDoneInOneAgentAction: true,
	hasSingleObservableOutput: true,
	hasSingleVerificationMethod: true,
	hasNoHiddenSubtasks: true,
};

async function harness() {
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const events: TaskEvent[] = [];
	const publications: string[] = [];
	const store = createTaskRuntimeStore();
	const pi: ExtensionAPI = {
		on: () => {},
		registerCommand: () => {},
		registerTool: (tool) => tools.set(tool.name, tool),
		appendEntry: (_type, data) => events.push(data as TaskEvent),
		events: { emit: (name) => publications.push(name) },
	};
	const ctx: ExtensionContext = {
		sessionManager: { getBranch: () => [] },
		ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
	};
	registerTaskTools(pi, store);
	const call = (name: string, params: Record<string, unknown>) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`Missing tool ${name}`);
		return tool.execute("call", params, undefined, undefined, ctx);
	};
	await call("task_plan", {
		title: "Parser behavior",
		objective: "Normalize parser aliases",
		acceptance_criteria: ["Alias behavior passes", "Existing inputs pass"],
		plan_steps: [
			{
				text: "Implement aliases and focused regression tests",
				expectedOutput: "Parser alias normalization preserves existing inputs",
				allowedActions: ["edit parser and tests", "run focused tests"],
				decompositionStatus: "atomic",
				granularityCheck: check,
			},
		],
	});
	return { call, store, events, publications, tools };
}

function entry(summary = "Parser tests passed", operation = "record") {
	return {
		operation,
		type: "test",
		level: "unit_test",
		summary,
		passed: "true",
		references: ["npm test -- parser"],
		step_ids: ["T1-S1"],
		criterion_ids: ["T1-AC1"],
		quality: {
			source: "vitest",
			reproducible: true,
			verifier: "tool",
			command: "npm test -- parser",
			artifactRefs: ["npm test -- parser"],
			observedOutput: "4 tests passed",
		},
	};
}

function verification() {
	const { step_ids: _steps, ...fields } = entry(
		"Existing input tests passed",
		"verify_step",
	);
	return { ...fields, step_id: "T1-S1", criterion_ids: ["T1-AC2"] };
}

function assertSchema(schema: Record<string, unknown>, value: unknown): void {
	if (schema.type === "object") {
		expect(value).toBeTypeOf("object");
		const record = value as Record<string, unknown>;
		const properties = schema.properties as Record<
			string,
			Record<string, unknown>
		>;
		for (const required of schema.required as string[])
			expect(record).toHaveProperty(required);
		for (const [key, field] of Object.entries(record)) {
			const property = properties[key];
			expect(property, `Undeclared property ${key}`).toBeDefined();
			if (property) assertSchema(property, field);
		}
	} else if (schema.type === "array") {
		expect(Array.isArray(value)).toBe(true);
		const values = value as unknown[];
		if (typeof schema.minItems === "number")
			expect(values.length).toBeGreaterThanOrEqual(schema.minItems);
		if (typeof schema.maxItems === "number")
			expect(values.length).toBeLessThanOrEqual(schema.maxItems);
		for (const item of values)
			assertSchema(schema.items as Record<string, unknown>, item);
	} else {
		expect(typeof value).toBe(schema.type);
		if (Array.isArray(schema.enum)) expect(schema.enum).toContain(value);
		if (typeof value === "string") {
			if (typeof schema.minLength === "number")
				expect(value.length).toBeGreaterThanOrEqual(schema.minLength);
			if (typeof schema.maxLength === "number")
				expect(value.length).toBeLessThanOrEqual(schema.maxLength);
		}
	}
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing test fixture value");
	return value;
}

describe("bounded atomic evidence batch", () => {
	it.each(["task_evidence", "task_verify_step", "task_evidence_batch"])(
		"requires an explicit summary edit in %s recovery",
		async (name) => {
			const h = await harness();
			const long = entry("Measured parser result. ".repeat(24));
			const params =
				name === "task_evidence_batch"
					? {
							task_id: "T1",
							entries: [entry(), { ...verification(), summary: long.summary }],
						}
					: name === "task_verify_step"
						? { task_id: "T1", ...verification(), summary: long.summary }
						: { task_id: "T1", ...long };
			const before = structuredClone(h.store.getState());
			const publications = h.publications.length;
			const rejected = await h.call(name, params);
			expect(rejected.isError).toBe(true);
			expect(h.store.getState()).toEqual(before);
			expect(h.events).toHaveLength(1);
			expect(h.publications).toHaveLength(publications);
			const recovery = rejected.details as {
				retry_example: Record<string, unknown>;
				retry_example_status: string;
				required_edits: string[];
			};
			expect(recovery.retry_example_status).toBe("requires_edit");
			expect(recovery.required_edits.join(" ")).toContain(
				"summary exceeds 500 characters",
			);
			expect(rejected.content[0]?.text).toContain(
				"Unvalidated evidence retry template",
			);
			expect(rejected.content[0]?.text).not.toContain(
				"Corrected evidence params",
			);
			const retry = structuredClone(recovery.retry_example);
			if (name === "task_evidence_batch") {
				const entries = retry.entries as Record<string, unknown>[];
				expect(entries[1]?.summary).toBe(long.summary);
				required(entries[1]).summary =
					"Parser regression suite measured four passing tests";
			} else {
				expect(retry.summary).toBe(long.summary);
				retry.summary = "Parser regression suite measured four passing tests";
			}
			const tool = required(h.tools.get(name));
			assertSchema(tool.parameters, retry);
			expect((await h.call(name, retry)).isError).not.toBe(true);
			const task = required(h.store.getState().tasks.T1);
			expect(task.evidence).toHaveLength(
				name === "task_evidence_batch" ? 2 : 1,
			);
			expect(task.evidence.at(-1)?.quality).toEqual(long.quality);
			expect(task.evidence.at(-1)?.references).toEqual(long.references);
			expect(task.planSteps[0]?.evidenceIds).toContain(
				task.evidence.at(-1)?.id,
			);
			if (name !== "task_evidence")
				expect(task.planSteps[0]?.status).toBe("done");
		},
	);

	it.each(["task_evidence", "task_evidence_batch"])(
		"requires an explicit diagnostic supersession edit in %s recovery",
		async (name) => {
			const h = await harness();
			for (const role of ["diagnostic", "acceptance"]) {
				expect(
					(
						await h.call("task_evidence", {
							task_id: "T1",
							...entry("Parser regression suite failed"),
							role,
							passed: "false",
						})
					).isError,
				).not.toBe(true);
			}
			const failed = required(h.store.getState().tasks.T1).evidence;
			const diagnosticId = required(failed[0]).id;
			const acceptanceId = required(failed[1]).id;
			const replacement = {
				...entry(),
				supersedes_evidence_ids: [diagnosticId, acceptanceId],
				reason: "Parser defect fixed and regression tests passed",
			};
			const before = structuredClone(h.store.getState());
			const eventCount = h.events.length;
			const publications = h.publications.length;
			const rejected = await h.call(
				name,
				name === "task_evidence_batch"
					? { task_id: "T1", entries: [replacement, verification()] }
					: { task_id: "T1", ...replacement },
			);
			expect(rejected.isError).toBe(true);
			expect(h.store.getState()).toEqual(before);
			expect(h.events).toHaveLength(eventCount);
			expect(h.publications).toHaveLength(publications);
			const recovery = rejected.details as {
				retry_example: Record<string, unknown>;
				retry_example_status: string;
				required_edits: string[];
			};
			expect(recovery.retry_example_status).toBe("requires_edit");
			expect(recovery.required_edits.join(" ")).toContain(
				`Evidence ${diagnosticId} is diagnostic and cannot be superseded`,
			);
			expect(rejected.content[0]?.text).not.toContain(
				"Corrected evidence params",
			);
			const retry = structuredClone(recovery.retry_example);
			const revised =
				name === "task_evidence_batch"
					? required((retry.entries as Record<string, unknown>[])[0])
					: retry;
			expect(revised.supersedes_evidence_ids).toEqual([
				diagnosticId,
				acceptanceId,
			]);
			// The caller explicitly removes only the diagnostic target, not the failing acceptance record.
			revised.supersedes_evidence_ids = [acceptanceId];
			assertSchema(required(h.tools.get(name)).parameters, retry);
			expect((await h.call(name, retry)).isError).not.toBe(true);
			const task = required(h.store.getState().tasks.T1);
			expect(task.evidence.slice(0, 2)).toEqual(before.tasks.T1?.evidence);
			expect(task.evidence[2]?.supersedesEvidenceIds).toEqual([acceptanceId]);
			expect(task.evidence[2]?.quality).toEqual(replacement.quality);
			expect(task.acceptanceCriteria[0]?.status).toBe("satisfied");
			if (name === "task_evidence_batch")
				expect(task.planSteps[0]?.status).toBe("done");
		},
	);

	it("persists one event, links separate checks, advances once and replays", async () => {
		const h = await harness();
		const result = await h.call("task_evidence_batch", {
			task_id: "T1",
			entries: [entry(), verification()],
		});
		expect(result.isError).not.toBe(true);
		expect(h.events).toHaveLength(2);
		expect(h.events[1]?.type).toBe("task.evidence_batch");
		expect(h.store.getState().tasks.T1?.evidence).toHaveLength(2);
		expect(h.store.getState().tasks.T1?.planSteps[0]?.status).toBe("done");
		expect(
			h.store
				.getState()
				.tasks.T1?.acceptanceCriteria.map((criterion) => criterion.status),
		).toEqual(["satisfied", "satisfied"]);
		const replay = createTaskRuntimeStore();
		expect(
			replay.replay(
				h.events.map((data) => ({
					type: "custom",
					customType: TASK_EVENT_CUSTOM_TYPE,
					data,
				})),
			).malformedEvents,
		).toEqual([]);
		expect(replay.getState()).toEqual(h.store.getState());
	});

	it("rejects a later invalid entry without persistence or publication", async () => {
		const h = await harness();
		const before = structuredClone(h.store.getState());
		const count = h.publications.length;
		const result = await h.call("task_evidence_batch", {
			task_id: "T1",
			entries: [entry(), { ...verification(), criterion_ids: ["T1-MISSING"] }],
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			"entry 2 rejected; no entries persisted",
		);
		expect(h.events).toHaveLength(1);
		expect(h.publications).toHaveLength(count);
		expect(h.store.getState()).toEqual(before);
	});

	it("returns artifact recovery without rerunning a successful check", async () => {
		const h = await harness();
		const invalid = entry();
		invalid.quality.artifactRefs = [];
		const result = await h.call("task_evidence_batch", {
			task_id: "T1",
			entries: [invalid],
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("task_evidence_batch");
		expect(result.content[0]?.text).toContain("artifactRefs");
		const recovery = result.details as {
			retry_example: {
				entries: Array<{ quality: { artifactRefs: string[] } }>;
			};
		};
		expect(recovery.retry_example.entries[0]?.quality.artifactRefs).toEqual([
			"npm test -- parser",
		]);
		expect(h.store.getState().tasks.T1?.evidence).toEqual([]);
	});

	it("recovers schema-valid mixed evidence with complete provenance and linkage", async () => {
		const h = await harness();
		const reviewed = {
			...entry("Parser behavior inspected"),
			type: "review",
			level: "static_read",
			quality: {
				...entry().quality,
				source: "source review",
				command: "Inspect parser behavior",
				artifactRefs: ["Inspect parser behavior"],
				observedOutput: "Parser alias branches inspected",
			},
		};
		const checked = verification();
		checked.quality.artifactRefs = [];
		const rejected = await h.call("task_evidence_batch", {
			task_id: "T1",
			entries: [reviewed, checked],
		});
		expect(rejected.isError).toBe(true);
		const recovery = rejected.details as {
			retry_example: Record<string, unknown>;
		};
		const tool = h.tools.get("task_evidence_batch");
		if (!tool) throw new Error("Missing batch tool");
		assertSchema(tool.parameters, recovery.retry_example);
		const accepted = await h.call(
			"task_evidence_batch",
			recovery.retry_example,
		);
		expect(accepted.isError).not.toBe(true);
		const task = h.store.getState().tasks.T1;
		expect(task?.evidence).toHaveLength(2);
		expect(task?.evidence[0]?.quality.source).toBe("source review");
		expect(task?.planSteps[0]?.status).toBe("done");
		expect(
			task?.acceptanceCriteria.map((criterion) => criterion.status),
		).toEqual(["satisfied", "satisfied"]);
	});

	it.each(["batch", "standalone"])(
		"rejects diagnostic %s verification through append and replay",
		async (route) => {
			const h = await harness();
			await h.call("task_evidence_batch", {
				task_id: "T1",
				entries: [verification()],
			});
			const original = h.events[1];
			if (original?.type !== "task.evidence_batch")
				throw new Error("Batch event missing");
			const first = original.entries[0];
			if (first?.type !== "task.step_verified")
				throw new Error("Verification entry missing");
			const payload = structuredClone(first);
			payload.evidence.role = "diagnostic";
			const malicious: TaskEvent =
				route === "batch"
					? { ...original, entries: [payload] }
					: { ...original, ...payload };
			const branch = [
				{
					type: "custom",
					customType: TASK_EVENT_CUSTOM_TYPE,
					data: h.events[0],
				},
			];
			const direct = createTaskRuntimeStore();
			direct.replay(branch);
			const before = structuredClone(direct.getState());
			expect(() =>
				direct.append(malicious, () => {
					throw new Error("Must not persist");
				}),
			).toThrow(/requires passing acceptance evidence/);
			expect(direct.getState()).toEqual(before);
			const replayed = createTaskRuntimeStore().replay([
				...branch,
				{ type: "custom", customType: TASK_EVENT_CUSTOM_TYPE, data: malicious },
			]);
			expect(replayed.malformedEvents).toHaveLength(1);
			expect(replayed.state.tasks.T1?.evidence).toEqual([]);
			expect(replayed.state.tasks.T1?.planSteps[0]?.status).not.toBe("done");
		},
	);

	it("keeps failures visible and completion blocked", async () => {
		const h = await harness();
		const failed = { ...entry("Parser tests failed"), passed: "false" };
		expect(
			(
				await h.call("task_evidence_batch", {
					task_id: "T1",
					entries: [failed],
				})
			).isError,
		).not.toBe(true);
		expect(h.store.getState().tasks.T1?.acceptanceCriteria[0]?.status).toBe(
			"failed",
		);
		expect(h.store.getState().tasks.T1?.evidence[0]?.passed).toBe(false);
		expect(
			(
				await h.call("task_evidence_batch", {
					task_id: "T1",
					entries: [verification()],
				})
			).isError,
		).not.toBe(true);
		const task = h.store.getState().tasks.T1;
		if (!task) throw new Error("Task missing");
		expect(
			(
				await h.call("task_complete", {
					task_id: "T1",
					summary: "Parser verification",
					evidence_ids: task.evidence.map((evidence) => evidence.id),
				})
			).isError,
		).toBe(true);
		expect(task.acceptanceCriteria[0]?.status).toBe("failed");
	});

	it("rejects diagnostic or failed verification without hiding record-only fields", async () => {
		for (const changes of [
			{ role: "diagnostic" },
			{ passed: "false" },
			{ supersedes_evidence_ids: ["E1"] },
			{ step_ids: ["T1-S1"] },
		]) {
			const h = await harness();
			expect(
				(
					await h.call("task_evidence_batch", {
						task_id: "T1",
						entries: [{ ...verification(), ...changes }],
					})
				).isError,
			).toBe(true);
			expect(h.events).toHaveLength(1);
		}
	});

	it("preserves proof on retry without duplicating evidence", async () => {
		const h = await harness();
		const params = { task_id: "T1", entries: [entry(), verification()] };
		expect((await h.call("task_evidence_batch", params)).isError).not.toBe(
			true,
		);
		expect((await h.call("task_evidence_batch", params)).isError).not.toBe(
			true,
		);
		expect(h.store.getState().tasks.T1?.evidence).toHaveLength(2);
	});

	it("bounds entries and serialized input", async () => {
		const h = await harness();
		for (const entries of [
			[],
			Array.from({ length: 17 }, () => entry()),
			[{ ...entry(), references: ["x".repeat(32_001)] }],
		]) {
			expect(
				(await h.call("task_evidence_batch", { task_id: "T1", entries }))
					.isError,
			).toBe(true);
		}
		expect(h.events).toHaveLength(1);
	});

	it("publishes explicit schemas and deliverable guidance", async () => {
		const h = await harness();
		const batch = h.tools.get("task_evidence_batch");
		if (!batch) throw new Error("Batch tool missing");
		expect(JSON.stringify(batch.parameters)).toContain('"maxItems":16');
		expect(JSON.stringify(batch.parameters)).toContain(
			"Required nonempty field for every evidence type",
		);
		expect(h.tools.get("task_plan")?.description).toContain(
			"bounded implementation cycle",
		);
	});
});
