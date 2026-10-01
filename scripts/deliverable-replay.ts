import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../src/pi-types.ts";

// Sanitized shape from task-7259 lines 119–158: a model/migration outcome
// split into mechanical steps, with wording/artifact recovery overhead.
const baseline = process.argv[2] ?? "6f1b2403707eabbba21dd70c16e1280072c39796";
const temporary = mkdtempSync(join(tmpdir(), "pi-tasks-replay-"));
const check = {
	isAtomic: true,
	reason: "One bounded storage outcome",
	canBeDoneInOneAgentAction: true,
	hasSingleObservableOutput: true,
	hasSingleVerificationMethod: true,
	hasNoHiddenSubtasks: true,
};
const outcome = {
	text: "Define storage model and matching migration",
	expectedOutput: "Model and migration declare matching storage fields",
	allowedActions: ["edit model and migration", "run focused schema tests"],
	decompositionStatus: "atomic",
	granularityCheck: check,
};
const mechanical = [
	{
		...outcome,
		text: "Define storage model",
		expectedOutput: "Storage model field declaration",
		allowedActions: ["edit model"],
	},
	{
		...outcome,
		text: "Create storage migration",
		expectedOutput: "Storage migration field declaration",
		allowedActions: ["edit migration"],
	},
];

async function replay(root: string, revised: boolean) {
	const { registerTaskTools } = await import(
		pathToFileURL(join(root, "src/tools.ts")).href
	);
	const { createTaskRuntimeStore } = await import(
		pathToFileURL(join(root, "src/store.ts")).href
	);
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
	let calls = 0;
	let rejections = 0;
	const call = async (
		name: string,
		params: Record<string, unknown>,
		rejected = false,
	) => {
		calls++;
		const tool = tools.get(name);
		assert.ok(tool, `Missing tool ${name}`);
		const result = await tool.execute(
			"replay",
			params,
			undefined,
			undefined,
			ctx,
		);
		assert.equal(result.isError === true, rejected, result.content[0]?.text);
		if (rejected) rejections++;
	};
	const plan = {
		title: "Storage field consistency",
		objective: "Keep storage model and migration aligned",
		acceptance_criteria: ["Model fields match", "Migration fields match"],
	};
	await call(
		"task_plan",
		{
			...plan,
			plan_steps: [
				{
					...outcome,
					granularityCheck: revised
						? {
								...check,
								unit: "deliverable",
								boundedScope:
									"Storage model and matching migration only; excludes API routes",
								verificationPlan:
									"Run two focused assertions for the model and migration declarations",
							}
						: check,
				},
			],
		},
		!revised,
	);
	if (!revised) await call("task_plan", { ...plan, plan_steps: mechanical });

	// Two independently observable synthetic checks, retained in both paths.
	const expected = ["id", "authorization_hash"];
	const model = { fields: ["id", "authorization_hash"] };
	const migration = { columns: ["id", "authorization_hash"] };
	assert.deepEqual(model.fields, expected);
	assert.deepEqual(migration.columns, expected);
	const proofs = ["Model fields matched", "Migration columns matched"].map(
		(summary, index) => ({
			type: "test",
			level: "unit_test",
			summary,
			references: ["scripts/deliverable-replay.ts"],
			criterion_ids: [`T1-AC${index + 1}`],
			quality: {
				source: "synthetic assertion",
				reproducible: true,
				verifier: "tool",
				command: "node scripts/deliverable-replay.ts",
				artifactRefs: ["scripts/deliverable-replay.ts"],
				observedOutput: summary,
			},
		}),
	);
	if (revised) {
		await call("task_evidence_batch", {
			task_id: "T1",
			entries: proofs.map((proof, index) =>
				index === 0
					? {
							...proof,
							operation: "record",
							passed: "true",
							step_ids: ["T1-S1"],
						}
					: {
							...proof,
							operation: "verify_step",
							passed: "true",
							step_id: "T1-S1",
						},
			),
		});
	} else {
		const firstProof = proofs[0];
		assert.ok(firstProof);
		await call(
			"task_verify_step",
			{
				task_id: "T1",
				step_id: "T1-S1",
				...proofs[0],
				quality: { ...firstProof.quality, artifactRefs: [] },
			},
			true,
		);
		for (const [index, proof] of proofs.entries())
			await call("task_verify_step", {
				task_id: "T1",
				step_id: `T1-S${index + 1}`,
				...proof,
			});
	}
	const evidence = store.getState().tasks.T1.evidence;
	await call("task_complete", {
		task_id: "T1",
		summary: "Synthetic storage consistency verified",
		evidence_ids: evidence.map((record: { id: string }) => record.id),
	});
	assert.equal(store.getState().tasks.T1.status, "done");
	assert.equal(evidence.length, 2);
	return {
		administrativeCalls: calls,
		rejections,
		verificationChecks: 2,
		evidenceRecords: evidence.length,
		status: "done",
	};
}

try {
	// Copy exact baseline sources without changing any repository checkout.
	const paths = execFileSync(
		"git",
		["ls-tree", "-r", "--name-only", baseline, "src"],
		{ encoding: "utf8" },
	)
		.trim()
		.split("\n");
	for (const path of paths) {
		assert.match(path, /^src\/[a-zA-Z0-9_./-]+\.ts$/);
		mkdirSync(resolve(temporary, path, ".."), { recursive: true });
		writeFileSync(
			join(temporary, path),
			execFileSync("git", ["show", `${baseline}:${path}`]),
		);
	}
	writeFileSync(join(temporary, "package.json"), '{"type":"module"}');
	const previous = await replay(temporary, false);
	const revised = await replay(resolve(import.meta.dirname, ".."), true);
	assert.ok(revised.administrativeCalls < previous.administrativeCalls);
	console.log(
		JSON.stringify(
			{
				kind: "local synthetic contract replay; not production latency",
				baseline,
				previous,
				revised,
				savedAdministrativeCalls:
					previous.administrativeCalls - revised.administrativeCalls,
			},
			null,
			2,
		),
	);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
