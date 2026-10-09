import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeReworkInput } from "../src/remediation.ts";
import type { TaskStateEvent } from "../src/state-events.ts";
import {
	compactExample,
	compactRemediation,
	detailedRemediation,
	fourActionsRemediation,
} from "./fixtures/remediation.ts";

const sdkRoot = process.env.PI_SDK_ROOT;
if (!sdkRoot) {
	throw new Error(
		"PI_SDK_ROOT is required for native extension tests; the test must not skip.",
	);
}

const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
const taskRoot = resolve(import.meta.dirname, "..");
const taskToolNames = new Set([
	"task_plan",
	"task_next",
	"task_focus",
	"task_resume",
	"task_checkpoint",
	"task_granularity_check",
	"task_decompose",
	"task_rework",
	"task_replan",
	"task_verify_step",
	"task_list",
	"task_update",
	"task_evidence",
	"task_evidence_batch",
	"task_decision",
	"task_complete",
]);

const cleanups: string[] = [];

afterEach(async () => {
	await Promise.all(
		cleanups
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

function activeTaskTools(session: {
	agent: { state: { tools: Array<{ name: string }> } };
}): string[] {
	return session.agent.state.tools
		.map((tool) => tool.name)
		.filter((name) => taskToolNames.has(name));
}

function isToolActive(
	session: { agent: { state: { tools: Array<{ name: string }> } } },
	name: string,
): boolean {
	return session.agent.state.tools.some((tool) => tool.name === name);
}

type NativeToolResult = {
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
};

type NativeTool = {
	name: string;
	execute(...args: unknown[]): Promise<NativeToolResult>;
};

function requireTool(
	session: { agent: { state: { tools: NativeTool[] } } },
	name: string,
): NativeTool {
	const tool = session.agent.state.tools.find(
		(candidate) => candidate.name === name,
	);
	if (!tool) throw new Error(`Expected active tool ${name}`);
	return tool;
}

function toolSurface(session: {
	systemPrompt: string;
	agent: {
		state: {
			tools: Array<{
				name: string;
				description?: string;
				parameters?: unknown;
				promptSnippet?: string;
				promptGuidelines?: string[];
			}>;
		};
	};
}): { schemaAndDescriptionChars: number; systemPromptChars: number } {
	const schemaAndDescriptionChars = session.agent.state.tools
		.filter((tool) => taskToolNames.has(tool.name))
		.reduce(
			(total, tool) =>
				total +
				(tool.description?.length ?? 0) +
				JSON.stringify(tool.parameters ?? {}).length,
			0,
		);
	return {
		schemaAndDescriptionChars,
		systemPromptChars: session.systemPrompt.length,
	};
}

async function waitForPersistedTaskEvent(
	sessionFile: string,
	eventType: "task.created" | "task.updated" = "task.created",
): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const contents = await readFile(sessionFile, "utf8");
		if (
			contents.includes('"customType":"pi-tasks:event"') &&
			contents.includes(`"type":"${eventType}"`)
		) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`pi-tasks ${eventType} event was not persisted to JSONL`);
}

function appendNativeToolCall(sessionManager: {
	appendMessage(message: unknown): string;
}): void {
	sessionManager.appendMessage({
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "native-plan-call",
				name: "task_plan",
				arguments: validPlan(),
			},
		],
		api: "native-test",
		provider: "native-test",
		model: "native-test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	});
}

function validPlan() {
	return {
		title: "Native persistence slice",
		objective: "Persist and restore a task without a model call",
		acceptance_criteria: ["The persisted task state restores"],
		plan_steps: [
			{
				text: "Persist task state",
				expectedOutput: "One pi-tasks custom event",
				criterionIds: ["T1-AC1"],
				evidenceRequired: true,
				allowedActions: ["task_plan"],
				decompositionStatus: "atomic",
				granularityCheck: {
					isAtomic: true,
					reason: "One tool call writes one custom event",
					canBeDoneInOneAgentAction: true,
					hasSingleObservableOutput: true,
					hasSingleVerificationMethod: true,
					hasNoHiddenSubtasks: true,
				},
			},
		],
	};
}

async function createNativeSession(
	options: {
		base?: string;
		sessionFile?: string;
		tools?: string[];
		excludeTools?: string[];
		foreignTaskNotes?: boolean;
		queuedSettlement?: boolean;
		pickupOrder?: "first" | "last";
		noTools?: "all" | "builtin";
	} = {},
) {
	const base =
		options.base ?? (await mkdtemp(join(tmpdir(), "pi-tasks-native-")));
	if (!options.base) cleanups.push(base);
	const cwd = join(base, "cwd");
	const agentDir = join(base, "agent");
	const sessionDir = join(base, "sessions");
	await Promise.all([
		mkdir(cwd, { recursive: true }),
		mkdir(agentDir, { recursive: true }),
	]);
	const events: TaskStateEvent[] = [];
	const extensionPaths = [join(taskRoot, "index.ts")];
	if (options.pickupOrder) {
		const pickupPath = join(
			taskRoot,
			"test/fixtures/infra-task-continuation/index.ts",
		);
		if (options.pickupOrder === "first") extensionPaths.unshift(pickupPath);
		else extensionPaths.push(pickupPath);
	}
	if (options.queuedSettlement) {
		const extensionPath = join(base, "queued-settlement.js");
		await writeFile(
			extensionPath,
			`export default function(pi) {
			let sent = false;
			pi.on("agent_before_settle", () => {
				if (sent) return;
				sent = true;
				return { entries: [{ type: "custom_message", customType: "native-review-result", content: "Independent review is ready", display: false }], continue: true };
			});
		}`,
		);
		extensionPaths.unshift(extensionPath);
	}
	if (options.foreignTaskNotes) {
		const extensionPath = join(base, "foreign-task-notes.js");
		await writeFile(
			extensionPath,
			`export default function (pi) {
	pi.registerTool({
		name: "task_notes",
		label: "Foreign Task Notes",
		description: "Foreign extension task notes.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		execute: async () => ({ content: [{ type: "text", text: "foreign" }] }),
	});
}`,
		);
		extensionPaths.push(extensionPath);
	}
	const eventBus = sdk.createEventBus();
	eventBus.on("pi-tasks:state", (event: TaskStateEvent) => {
		events.push(event);
	});
	const settingsManager = sdk.SettingsManager.inMemory({});
	const resourceLoader = new sdk.DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		eventBus,
		additionalExtensionPaths: extensionPaths,
	});
	await resourceLoader.reload();
	expect(resourceLoader.getExtensions().errors).toEqual([]);
	const sessionManager = options.sessionFile
		? sdk.SessionManager.open(options.sessionFile, sessionDir)
		: sdk.SessionManager.create(cwd, sessionDir);
	const result = await sdk.createAgentSession({
		cwd,
		agentDir,
		resourceLoader,
		sessionManager,
		...(options.tools ? { tools: options.tools } : {}),
		...(options.excludeTools ? { excludeTools: options.excludeTools } : {}),
		...(options.noTools ? { noTools: options.noTools } : {}),
	});
	await result.session.bindExtensions(result.extensionsResult);
	return { ...result, base, cwd, sessionDir, events, sessionManager, eventBus };
}

describe("native Pi settlement advisories", () => {
	it.each([
		"actionable",
		"async",
		"async-file",
		"queued",
		"completed",
		"pickup-first",
		"pickup-last",
		"pickup-async-first",
		"pickup-async-last",
		"pickup-interleaved-first",
		"pickup-interleaved-last",
	])(
		"handles %s work through the native settlement boundary",
		async (scenario) => {
			const h = await createNativeSession({
				queuedSettlement: scenario === "queued",
				...(scenario.startsWith("pickup-")
					? {
							pickupOrder: scenario.endsWith("first")
								? ("first" as const)
								: ("last" as const),
						}
					: {}),
			});
			try {
				const provider = "openai";
				await h.session.modelRuntime.setRuntimeApiKey(provider, "test-only");
				await h.session.setModel({
					id: "scripted",
					name: "Scripted settlement",
					api: "openai-responses",
					provider,
					baseUrl: "http://unused.invalid",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 100000,
					maxTokens: 1000,
				});
				type Call = { name: string; arguments: Record<string, unknown> };
				const verify: Call = {
					name: "task_verify_step",
					arguments: {
						task_id: "T1",
						step_id: "T1-S1",
						type: "review",
						level: "static_read",
						summary: "Independent review passed",
						references: ["native-review.json"],
						quality: {
							source: "scripted reviewer",
							reproducible: true,
							verifier: "tool",
							command: "inspect native task",
							artifactRefs: ["native-review.json"],
							observedOutput: "No findings",
						},
					},
				};
				const complete: Call = {
					name: "task_complete",
					arguments: {
						task_id: "T1",
						summary: "Native task verified",
						evidence_ids: ["E1"],
					},
				};
				const replies: Call[][] = [
					[{ name: "task_plan", arguments: validPlan() }],
				];
				if (scenario === "pickup-first" || scenario === "pickup-last") {
					replies.unshift(
						[
							{
								name: "task_pickup",
								arguments: {
									task_id: "5168",
									disposition: "proceed",
									next_action: "Complete authorized readiness and plan work",
								},
							},
						],
						[],
					);
					replies.push([]);
				} else if (scenario === "completed")
					replies.push([verify], [complete], []);
				else if (scenario === "queued")
					replies.push([], [verify], [complete], []);
				else replies.push([]);
				if (scenario === "actionable") replies.push([]);
				let requests = 0;
				h.session.agent.streamFunction = () => {
					const calls = replies.shift();
					if (!calls) throw new Error("Unexpected extra model request");
					requests += 1;
					if (scenario.startsWith("pickup-async-") && requests === 1)
						h.eventBus.emit("subagent:async-complete", {
							runId: "native-review",
							sessionId: h.sessionManager.getSessionId(),
						});
					const message = {
						role: "assistant",
						content: calls.length
							? calls.map((call, index) => ({
									type: "toolCall",
									id: `native-${requests}-${index}`,
									...call,
								}))
							: [{ type: "text", text: "Work settled" }],
						api: "openai-responses",
						provider,
						model: "scripted",
						stopReason: calls.length ? "toolUse" : "stop",
						timestamp: Date.now(),
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								total: 0,
							},
						},
					};
					return {
						async *[Symbol.asyncIterator]() {
							yield { type: "start", partial: message };
							yield { type: "done", reason: message.stopReason, message };
						},
						result: async () => message,
					};
				};
				const sessionId =
					scenario === "async-file"
						? h.sessionManager.getSessionFile()
						: h.sessionManager.getSessionId();
				if (scenario === "async-file") {
					expect(sessionId).toBeTruthy();
					expect(sessionId).not.toBe(h.sessionManager.getSessionId());
				}
				if (
					scenario.startsWith("async") ||
					scenario.startsWith("pickup-async-") ||
					scenario.startsWith("pickup-interleaved-")
				)
					h.eventBus.emit("subagent:async-started", {
						id: "native-review",
						sessionId,
					});
				let completionScheduled = false;
				const stopCompletion = scenario.startsWith("pickup-interleaved-")
					? h.eventBus.on("task-continuation:ownership", () => {
							if (completionScheduled) return;
							completionScheduled = true;
							queueMicrotask(() =>
								h.eventBus.emit("subagent:async-complete", {
									runId: "native-review",
									sessionId,
								}),
							);
						})
					: undefined;
				await h.session.prompt("Run scripted task execution");
				stopCompletion?.();
				if (scenario.startsWith("pickup-interleaved-"))
					expect(completionScheduled).toBe(true);
				const advisories = () =>
					h.sessionManager
						.getBranch()
						.filter(
							(entry: { type: string; customType?: string }) =>
								entry.type === "custom_message" &&
								entry.customType === "pi-tasks:yield-check",
						);
				expect(advisories()).toHaveLength(scenario === "actionable" ? 1 : 0);
				if (scenario === "pickup-first" || scenario === "pickup-last") {
					const entries = h.sessionManager.getBranch();
					for (const type of [
						"task-continuation:nudge",
						"task-continuation:stall",
					]) {
						expect(
							entries.filter(
								(entry: { customType?: string }) => entry.customType === type,
							),
						).toHaveLength(1);
					}
				}
				expect(requests).toBe(
					scenario === "pickup-first" || scenario === "pickup-last"
						? 4
						: scenario === "actionable"
							? 3
							: scenario === "completed"
								? 4
								: scenario === "queued"
									? 5
									: 2,
				);
				expect(replies).toHaveLength(0);
				expect(
					h.session.messages.filter(
						(message: { role: string; isError?: boolean }) =>
							message.role === "toolResult" && message.isError,
					),
				).toHaveLength(0);
				if (
					scenario.startsWith("pickup-async-") ||
					scenario.startsWith("pickup-interleaved-")
				) {
					replies.push(
						[
							{
								name: "task_update",
								arguments: { task_id: "T1", note: "Fresh input" },
							},
						],
						[],
						[],
					);
					await h.session.prompt("Continue with fresh standalone work");
					expect(advisories()).toHaveLength(1);
					expect(requests).toBe(5);
					expect(replies).toHaveLength(0);
				}
				if (scenario.startsWith("async")) {
					const update: Call = {
						name: "task_update",
						arguments: {
							task_id: "T1",
							progress: 40,
							next_action: "Inspect independent review",
						},
					};
					h.eventBus.emit("subagent:async-complete", {
						runId: "native-review",
						sessionId: "foreign",
					});
					replies.push([update], []);
					await h.session.prompt("Continue while review is still running");
					expect(advisories()).toHaveLength(0);
					h.eventBus.emit("subagent:async-complete", {
						runId: "native-review",
						sessionId,
					});
					replies.push([update], [], []);
					await h.session.prompt("Continue after review completion");
					expect(advisories()).toHaveLength(1);
					expect(requests).toBe(7);
					expect(replies).toHaveLength(0);
				}
			} finally {
				h.session.dispose();
			}
		},
	);
});

describe("compact remediation native validation and local benchmark", () => {
	it("replays observed action-limit/wording/closed-target fixtures with measured recovery calls", async () => {
		const ai = await import(
			pathToFileURL(join(sdkRoot, "..", "pi-ai", "dist/index.js")).href
		);
		const h = await createNativeSession();
		try {
			await requireTool(h.session, "task_plan").execute(
				"plan",
				validPlan(),
				undefined,
				undefined,
			);
			// Retire S1 with the ordinary replan operation, leaving the explicit S2 gate open.
			await requireTool(h.session, "task_replan").execute(
				"replan",
				{
					task_id: "T1",
					step_ids: ["T1-S1"],
					reason: "Replace synthetic gate",
					plan_steps: validPlan().plan_steps,
				},
				undefined,
				undefined,
			);
			const tool = requireTool(h.session, "task_rework");
			const initialCount = h.sessionManager.getEntries().length;
			let detailedCalls = 0;
			const checked = async (input: unknown) => {
				const args = ai.validateToolArguments(tool, {
					type: "toolCall",
					id: "fixture",
					name: "task_rework",
					arguments: input,
				});
				return tool.execute("fixture", args, undefined, undefined);
			};
			detailedCalls++;
			await expect(checked(fourActionsRemediation)).rejects.toThrow(
				/allowedActions/,
			);
			expect(h.sessionManager.getEntries()).toHaveLength(initialCount);
			detailedCalls++;
			const wording = await checked({
				...detailedRemediation,
				plan_steps: [
					{
						...detailedRemediation.plan_steps[0],
						granularityCheck: {
							...detailedRemediation.plan_steps[0].granularityCheck,
							unit: "action",
						},
					},
				],
			});
			expect(wording.isError).toBe(true);
			expect(wording.content[0]?.text).toMatch(/rejects compound wording/);
			expect(h.sessionManager.getEntries()).toHaveLength(initialCount);
			detailedCalls++;
			expect((await checked(detailedRemediation)).isError).not.toBe(true);
			const compactCalls = 1;
			expect((await checked(compactRemediation)).isError).not.toBe(true);
			const readme = await readFile(join(taskRoot, "README.md"), "utf8");
			const documented = [...readme.matchAll(/```json\n([\s\S]*?)\n```/g)]
				.map((match) => JSON.parse(match[1] as string))
				.find((example) => example.remediation);
			expect(documented).toEqual(compactExample);
			expect((await checked(documented)).isError).not.toBe(true);
			const count = h.sessionManager.getEntries().length;
			for (const before_step_id of ["T1-S1", "nonexistent"]) {
				const rejected = await checked({
					...compactRemediation,
					before_step_id,
				});
				expect(rejected.isError).toBe(true);
				expect(rejected.content[0]?.text).toContain(
					"Choose an explicit open target from:",
				);
				expect(rejected.content[0]?.text).toContain("T1-S2");
				expect(h.sessionManager.getEntries()).toHaveLength(count);
			}
			const detailed = normalizeReworkInput(detailedRemediation).planSteps[0];
			const compact = normalizeReworkInput(compactRemediation).planSteps[0];
			for (const field of [
				"expectedOutput",
				"criterionIds",
				"evidenceRequired",
				"decompositionStatus",
			] as const)
				expect(compact?.[field]).toEqual(detailed?.[field]);
			for (const field of [
				"unit",
				"boundedScope",
				"verificationPlan",
				"isAtomic",
				"canBeDoneInOneAgentAction",
				"hasSingleObservableOutput",
				"hasSingleVerificationMethod",
				"hasNoHiddenSubtasks",
			] as const)
				expect(compact?.granularityCheck?.[field]).toEqual(
					detailed?.granularityCheck?.[field],
				);
			const detailedBytes = Buffer.byteLength(
				JSON.stringify(detailedRemediation),
			);
			const compactBytes = Buffer.byteLength(
				JSON.stringify(compactRemediation),
			);
			expect(compactBytes).toBeLessThan(detailedBytes);
			expect(compactCalls).toBeLessThan(detailedCalls);
			console.info(
				JSON.stringify({
					benchmark: "sanitized-remediation-fixtures",
					detailedBytes,
					compactBytes,
					detailedCalls,
					compactCalls,
					closedTargetCalls: 1,
					note: "Controlled fixture calls, not elapsed time or autonomous model performance",
				}),
			);
		} finally {
			h.session.dispose();
		}
	});
});

describe("native Pi dynamic task tools", () => {
	it("dogfoods cohesive batch persistence, task command, resume and branch isolation", async () => {
		const first = await createNativeSession();
		try {
			appendNativeToolCall(first.sessionManager);
			const plan = validPlan();
			const step = plan.plan_steps[0];
			assert.ok(step);
			Object.assign(step, {
				text: "Implement storage fields and focused regression tests",
				expectedOutput: "Storage model and migration fields match",
				allowedActions: ["edit model and tests", "run focused tests"],
				granularityCheck: {
					...step.granularityCheck,
					unit: "deliverable",
					boundedScope:
						"Storage field consistency only; excludes API transport",
					verificationPlan:
						"Run focused consistency checks for storage model and migration",
				},
			});
			expect(
				(
					await requireTool(first.session, "task_plan").execute(
						"batch-plan",
						plan,
						undefined,
						undefined,
					)
				).isError,
			).not.toBe(true);
			expect(
				(
					await requireTool(first.session, "task_update").execute(
						"batch-update",
						{
							task_id: "T1",
							progress: 50,
							next_action: "Run focused consistency tests",
						},
						undefined,
						undefined,
					)
				).isError,
			).not.toBe(true);
			const beforeBatch = first.sessionManager.getEntries().at(-1);
			assert.ok(beforeBatch);
			const result = await requireTool(
				first.session,
				"task_evidence_batch",
			).execute(
				"native-batch",
				{
					task_id: "T1",
					entries: [
						{
							operation: "verify_step",
							step_id: "T1-S1",
							type: "test",
							level: "unit_test",
							summary: "Native consistency assertion passed",
							passed: "true",
							references: ["test/extension.test.ts"],
							quality: {
								source: "native dogfood",
								reproducible: true,
								verifier: "tool",
								command: "PI_SDK_ROOT=<installed SDK> npm run test:native",
								artifactRefs: ["test/extension.test.ts"],
								observedOutput: "Batch event persisted and replayed",
							},
						},
					],
				},
				undefined,
				undefined,
			);
			expect(result.isError).not.toBe(true);
			const afterBatch = first.sessionManager.getEntries().at(-1);
			assert.ok(afterBatch);
			await first.session.prompt("/tasks detail");
			await first.session.navigateTree(beforeBatch.id, { summarize: false });
			expect(
				(
					await requireTool(first.session, "task_resume").execute(
						"before-batch",
						{},
						undefined,
						undefined,
					)
				).content[0]?.text,
			).toContain("T1-S1");
			await first.session.navigateTree(afterBatch.id, { summarize: false });
			expect(
				(
					await requireTool(first.session, "task_resume").execute(
						"after-batch",
						{},
						undefined,
						undefined,
					)
				).content[0]?.text,
			).toContain("task_complete");
			const sessionFile = first.sessionManager.getSessionFile();
			assert.ok(sessionFile);
			await waitForPersistedTaskEvent(sessionFile);
			first.session.dispose();
			const restored = await createNativeSession({
				base: first.base,
				sessionFile,
			});
			try {
				expect(isToolActive(restored.session, "task_evidence_batch")).toBe(
					true,
				);
				expect(
					(
						await requireTool(restored.session, "task_resume").execute(
							"restored-batch",
							{},
							undefined,
							undefined,
						)
					).content[0]?.text,
				).toContain("task_complete");
			} finally {
				restored.session.dispose();
			}
		} finally {
			first.session.dispose();
		}
	});

	it("runs the persistent plan-to-event-to-new-session restore slice before broader cases", async () => {
		const first = await createNativeSession();
		try {
			expect(activeTaskTools(first.session)).toEqual([
				"task_plan",
				"task_resume",
			]);
			const fresh = toolSurface(first.session);
			expect(first.session.systemPrompt).toContain(
				"Use task_plan for multi-step work before implementation when no suitable active task exists.",
			);

			appendNativeToolCall(first.sessionManager);
			const created = await requireTool(first.session, "task_plan").execute(
				"native-plan",
				validPlan(),
				undefined,
				undefined,
			);
			expect(created.content[0]?.text).toContain("Created task T1");
			expect(
				first.sessionManager
					.getEntries()
					.some(
						(entry: { type: string; customType?: string }) =>
							entry.type === "custom" && entry.customType === "pi-tasks:event",
					),
			).toBe(true);
			expect(activeTaskTools(first.session)).toContain("task_update");
			expect(new Set(activeTaskTools(first.session))).toEqual(taskToolNames);
			const taskEntry = first.sessionManager.getEntries().at(-1);
			const precedingEntry = first.sessionManager.getEntries().at(-2);
			assert.ok(taskEntry);
			assert.ok(precedingEntry);
			await first.session.navigateTree(precedingEntry.id, { summarize: false });
			expect(first.events).toContainEqual(
				expect.objectContaining({
					reason: "session_tree",
					widgetId: "pi-tasks",
				}),
			);
			expect(activeTaskTools(first.session)).toEqual([
				"task_plan",
				"task_resume",
			]);
			await first.session.navigateTree(taskEntry.id, { summarize: false });
			expect(new Set(activeTaskTools(first.session))).toEqual(taskToolNames);
			expect(
				first.session.agent.state.tools.some(
					(tool: { name: string }) => tool.name === "read",
				),
			).toBe(true);
			const active = toolSurface(first.session);
			expect(active.schemaAndDescriptionChars).toBeGreaterThan(
				fresh.schemaAndDescriptionChars,
			);
			expect(first.session.systemPrompt).toContain(
				"Use task_plan for multi-step work before implementation when no suitable active task exists.",
			);
			console.info(
				`pi-tasks surface chars fresh schema+description=${fresh.schemaAndDescriptionChars}, system-prompt=${fresh.systemPromptChars}; active schema+description=${active.schemaAndDescriptionChars}, system-prompt=${active.systemPromptChars}`,
			);
			const repaired = await requireTool(first.session, "task_replan").execute(
				"native-replan",
				{
					task_id: "T1",
					step_ids: ["T1-S1"],
					reason: "Replace synthetic planning mistake",
					plan_steps: validPlan().plan_steps,
				},
				undefined,
				undefined,
			);
			expect(repaired.isError).not.toBe(true);
			expect(repaired.content[0]?.text).toContain("T1-S2");
			const beforeRework = first.sessionManager.getEntries().at(-1);
			assert.ok(beforeRework);
			const reworked = await requireTool(first.session, "task_rework").execute(
				"native-rework",
				{
					task_id: "T1",
					reason: "Review found a generated contract mismatch",
					before_step_id: "T1-S2",
					plan_steps: validPlan().plan_steps,
				},
				undefined,
				undefined,
			);
			expect(reworked.isError).not.toBe(true);
			expect(reworked.content[0]?.text).toContain("T1-S3");
			const afterRework = first.sessionManager.getEntries().at(-1);
			assert.ok(afterRework);
			await first.session.navigateTree(beforeRework.id, { summarize: false });
			expect(
				(
					await requireTool(first.session, "task_resume").execute(
						"before-rework",
						{},
						undefined,
						undefined,
					)
				).content[0]?.text,
			).toContain("T1-S2");
			await first.session.navigateTree(afterRework.id, { summarize: false });
			expect(
				(
					await requireTool(first.session, "task_resume").execute(
						"after-rework",
						{},
						undefined,
						undefined,
					)
				).content[0]?.text,
			).toContain("T1-S3");

			const sessionFile = first.sessionManager.getSessionFile();
			assert.ok(sessionFile);
			await waitForPersistedTaskEvent(sessionFile);
			first.session.dispose();
			const restored = await createNativeSession({
				base: first.base,
				sessionFile,
			});
			try {
				expect(activeTaskTools(restored.session)).toContain("task_replan");
				const resumed = await requireTool(
					restored.session,
					"task_resume",
				).execute("resume", {}, undefined, undefined);
				expect(resumed.content[0]?.text).toContain("T1-S3");
				expect(restored.events).toContainEqual(
					expect.objectContaining({
						reason: "session_start",
						widgetId: "pi-tasks",
					}),
				);
			} finally {
				restored.session.dispose();
			}
		} finally {
			first.session.dispose();
		}
	});

	it("keeps foreign task_notes outside pi-tasks reconciliation", async () => {
		const active = await createNativeSession({ foreignTaskNotes: true });
		try {
			expect(isToolActive(active.session, "task_notes")).toBe(true);
			appendNativeToolCall(active.sessionManager);
			await requireTool(active.session, "task_plan").execute(
				"foreign-active-plan",
				validPlan(),
				undefined,
				undefined,
			);
			expect(isToolActive(active.session, "task_notes")).toBe(true);
			await requireTool(active.session, "task_resume").execute(
				"foreign-active-resume",
				{},
				undefined,
				undefined,
			);
			expect(isToolActive(active.session, "task_notes")).toBe(true);
			const taskEntry = active.sessionManager.getEntries().at(-1);
			assert.ok(taskEntry);
			await active.session.navigateTree(taskEntry.id, { summarize: false });
			expect(isToolActive(active.session, "task_notes")).toBe(true);
		} finally {
			active.session.dispose();
		}

		const inactive = await createNativeSession({
			foreignTaskNotes: true,
			tools: ["read", "task_plan", "task_resume"],
		});
		try {
			expect(isToolActive(inactive.session, "task_notes")).toBe(false);
			await requireTool(inactive.session, "task_plan").execute(
				"foreign-inactive-plan",
				validPlan(),
				undefined,
				undefined,
			);
			expect(isToolActive(inactive.session, "task_notes")).toBe(false);
			await requireTool(inactive.session, "task_resume").execute(
				"foreign-inactive-resume",
				{},
				undefined,
				undefined,
			);
			expect(isToolActive(inactive.session, "task_notes")).toBe(false);
			const taskEntry = inactive.sessionManager.getEntries().at(-1);
			assert.ok(taskEntry);
			await inactive.session.navigateTree(taskEntry.id, { summarize: false });
			expect(isToolActive(inactive.session, "task_notes")).toBe(false);
		} finally {
			inactive.session.dispose();
		}
	});

	it("preserves allowlists, exclusions, noTools, and unrelated active tools", async () => {
		const planOnly = await createNativeSession({
			tools: ["read", "task_plan"],
		});
		try {
			expect(activeTaskTools(planOnly.session)).toEqual(["task_plan"]);
			await requireTool(planOnly.session, "task_plan").execute(
				"plan-only",
				validPlan(),
				undefined,
				undefined,
			);
			expect(activeTaskTools(planOnly.session)).toEqual(["task_plan"]);
			expect(
				planOnly.session.agent.state.tools.some(
					(tool: { name: string }) => tool.name === "read",
				),
			).toBe(true);
		} finally {
			planOnly.session.dispose();
		}

		const excluded = await createNativeSession({
			tools: ["read", "task_plan", "task_resume", "task_update"],
			excludeTools: ["task_update"],
		});
		try {
			await requireTool(excluded.session, "task_plan").execute(
				"excluded",
				validPlan(),
				undefined,
				undefined,
			);
			expect(activeTaskTools(excluded.session)).toEqual([
				"task_plan",
				"task_resume",
			]);
			expect(
				excluded.session.agent.state.tools.some(
					(tool: { name: string }) => tool.name === "read",
				),
			).toBe(true);
		} finally {
			excluded.session.dispose();
		}

		const disabled = await createNativeSession({ noTools: "all" });
		try {
			expect(activeTaskTools(disabled.session)).toEqual([]);
		} finally {
			disabled.session.dispose();
		}
	});

	it("does not activate controls after a rejected plan and restores blocked task controls", async () => {
		const rejected = await createNativeSession();
		try {
			const result = await requireTool(rejected.session, "task_plan").execute(
				"rejected",
				{
					title: "Rejected plan",
					objective: "Verify rejected persistence does not activate controls",
					acceptance_criteria: ["No controls activate"],
					plan_steps: [],
				},
				undefined,
				undefined,
			);
			expect(result.isError).toBe(true);
			expect(activeTaskTools(rejected.session)).toEqual([
				"task_plan",
				"task_resume",
			]);
		} finally {
			rejected.session.dispose();
		}

		const first = await createNativeSession();
		try {
			appendNativeToolCall(first.sessionManager);
			await requireTool(first.session, "task_plan").execute(
				"blocked-plan",
				validPlan(),
				undefined,
				undefined,
			);
			const blocked = await requireTool(first.session, "task_update").execute(
				"blocked-update",
				{
					task_id: "T1",
					status: "blocked",
					blocker: {
						reason: "Waiting for a required decision",
						blockedBy: "user",
						neededToUnblock: "User decision",
					},
				},
				undefined,
				undefined,
			);
			expect(blocked.isError).not.toBe(true);
			const sessionFile = first.sessionManager.getSessionFile();
			assert.ok(sessionFile);
			await waitForPersistedTaskEvent(sessionFile, "task.updated");
			first.session.dispose();
			const restored = await createNativeSession({
				base: first.base,
				sessionFile,
			});
			try {
				expect(new Set(activeTaskTools(restored.session))).toEqual(
					taskToolNames,
				);
				const recovered = await requireTool(
					restored.session,
					"task_list",
				).execute(
					"blocked-recovery",
					{ include_history: true },
					undefined,
					undefined,
				);
				expect(recovered.content[0]?.text).toContain("blocked");
				expect(restored.events.every((event) => !("state" in event))).toBe(
					true,
				);
				expect(restored.events).toContainEqual(
					expect.objectContaining({
						reason: "session_start",
						version: 2,
						context: expect.objectContaining({ version: 1 }),
					}),
				);
			} finally {
				restored.session.dispose();
			}
		} finally {
			first.session.dispose();
		}
	});
});
