import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
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

// PI_SDK_ROOT selects the installed SDK version under test; a static import
// would resolve the repository's dependencies instead of that release.
const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
const piAi = await import(
	pathToFileURL(join(sdkRoot, "..", "pi-ai", "dist", "index.js")).href
);
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
	details?: unknown;
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
	eventType:
		| "task.created"
		| "task.updated"
		| "task.evidence_added" = "task.created",
): Promise<void> {
	const contents = await readFile(sessionFile, "utf8");
	if (
		!contents.includes('"customType":"pi-tasks:event"') ||
		!contents.includes(`"type":"${eventType}"`)
	) {
		throw new Error(`pi-tasks ${eventType} event was not persisted to JSONL`);
	}
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
		telemetry?: boolean;
		thresholdContinuation?: boolean;
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
	if (options.telemetry) extensionPaths.push(join(taskRoot, "telemetry.ts"));
	if (options.thresholdContinuation)
		extensionPaths.push(
			process.env.PI_THRESHOLD_CONTINUATION_EXTENSION ??
				join(taskRoot, "test/fixtures/resume-after-threshold-compaction.ts"),
		);
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

describe("native compaction recovery replay benchmark", () => {
	it("keeps next-action continuity and one continuation owner across native hook paths", async () => {
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "pilot");
		const directory = await mkdtemp(join(tmpdir(), "pi-pilot-replay-"));
		cleanups.push(directory);
		vi.stubEnv("PI_TASKS_TELEMETRY_DIR", directory);
		const h = await createNativeSession({
			telemetry: true,
			thresholdContinuation: true,
		});
		const runner = h.session.extensionRunner;
		const errors: unknown[] = [];
		const stopErrors = runner.onError((error: unknown) => errors.push(error));
		const send = vi
			.spyOn(h.session, "sendCustomMessage")
			.mockResolvedValue(undefined);
		try {
			execFileSync("git", ["init", "-b", "pilot"], {
				cwd: h.cwd,
				stdio: "pipe",
			});
			execFileSync(
				"git",
				[
					"-c",
					"user.name=Test",
					"-c",
					"user.email=test@example.com",
					"commit",
					"--allow-empty",
					"-m",
					"fixture",
				],
				{ cwd: h.cwd, stdio: "pipe" },
			);
			h.sessionManager.appendMessage({
				role: "user",
				content: "Implement only the bounded fixture",
				timestamp: Date.now(),
			});
			appendNativeToolCall(h.sessionManager);
			await requireTool(h.session, "task_plan").execute(
				"pilot-plan",
				validPlan(),
			);
			const before = (
				await requireTool(h.session, "task_resume").execute("before", {})
			).details;
			const emitBefore = (
				reason: string,
				instructions?: string,
				retention = 20_000,
			) =>
				runner.emit({
					type: "session_before_compact",
					reason,
					willRetry: reason === "overflow",
					customInstructions: instructions,
					preparation: {
						tokensBefore: 125_000,
						settings: { reserveTokens: 16_384, keepRecentTokens: retention },
					},
					branchEntries: h.sessionManager.getBranch(),
					signal: new AbortController().signal,
				});
			const emitSuccess = (reason: string, id: string) =>
				runner.emit({
					type: "session_compact",
					reason,
					willRetry: reason === "overflow",
					fromExtension: false,
					compactionEntry: {
						id,
						timestamp: new Date().toISOString(),
						tokensBefore: 125_000,
					},
				});
			const rows: Array<{
				path: string;
				extensionContinuations: number;
				nativeRetry: boolean;
			}> = [];
			for (const reason of ["manual", "threshold", "overflow"]) {
				send.mockClear();
				const hook = await emitBefore(reason);
				expect(hook?.cancel).not.toBe(true);
				expect(hook?.compaction).toBeUndefined();
				await emitSuccess(reason, `native-${reason}`);
				const count = reason === "threshold" ? 1 : 0;
				expect(send).toHaveBeenCalledTimes(count);
				rows.push({
					path: reason,
					extensionContinuations: send.mock.calls.length,
					nativeRetry: reason === "overflow",
				});
			}
			send.mockClear();
			await emitBefore("threshold");
			await runner.emit({
				type: "session_compact_failed",
				reason: "threshold",
				willRetry: false,
				aborted: false,
				errorMessage: "fixture failure",
				fromExtension: false,
			});
			expect(send).not.toHaveBeenCalled();
			rows.push({
				path: "failure",
				extensionContinuations: 0,
				nativeRetry: false,
			});
			const usageSpy = vi.spyOn(h.session, "getContextUsage").mockReturnValue({
				tokens: 150_000,
				contextWindow: 1_000_000,
				percent: 15,
			});
			const compactSpy = vi
				.spyOn(h.session, "compact")
				.mockImplementation(async (instructions?: string) => {
					await emitBefore("manual", instructions);
					await emitSuccess("manual", "pilot-native");
					return {
						summary: "synthetic native hook replay",
						firstKeptEntryId: "fixture",
						tokensBefore: 150_000,
					};
				});
			// Direct tool.execute above bypasses the agent's normal tool_result dispatch.
			await runner.emitToolResult({
				type: "tool_result",
				toolName: "task_plan",
				toolCallId: "pilot-plan",
				input: validPlan(),
				content: [],
				details: before,
				isError: false,
			});
			// Real ExtensionContext.compact dispatches asynchronously through AgentSession.compact.
			await runner.emit({ type: "agent_settled", aborted: false });
			await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
			expect(compactSpy).toHaveBeenCalledTimes(1);
			expect(send.mock.calls[0]?.[0]).toMatchObject({
				customType: "pi-tasks:compaction-recovery",
				content: expect.stringContaining("Call task_resume"),
			});
			const after = (
				await requireTool(h.session, "task_resume").execute("after", {})
			).details;
			expect(after.currentStepId).toBe(before.currentStepId);
			expect(after.recovery.checks).toMatchObject({
				identity: "pass",
				authority: "unknown",
				authorityGranted: false,
			});
			expect(after.recovery.checkpoint.nextAction).toBe(before.currentStepText);
			rows.push({
				path: "pilot",
				extensionContinuations: 1,
				nativeRetry: false,
			});
			compactSpy.mockRestore();
			usageSpy.mockRestore();
			const { TelemetryStore } = await import("../src/compaction-telemetry.ts");
			const records = new TelemetryStore(directory).read().records;
			expect(records.some((r) => r.policyDecision === "fallback")).toBe(true);
			expect(
				records.filter(
					(r) => r.kind === "compaction_end" && r.outcome === "failure",
				),
			).toHaveLength(1);
			expect(errors).toEqual([]);
			console.log(
				JSON.stringify({
					benchmark: "native-hook-recovery-replay",
					sdk: sdkRoot,
					continuation:
						process.env.PI_THRESHOLD_CONTINUATION_EXTENSION ?? "pinned fixture",
					rows,
					nextActionContinuity: true,
					telemetryRecords: records.length,
					limits:
						"Synthetic dispatch and compaction transport; no provider summarization, activation or live performance claim",
				}),
			);
		} finally {
			send.mockRestore();
			stopErrors();
			h.session.dispose();
			vi.unstubAllEnvs();
		}
	});
});

describe("native pilot lifecycle interruptions", () => {
	it.each([
		"input",
		"session_tree",
		"session_shutdown",
		"pending",
		"live-child",
	])("suppresses outstanding recovery after %s dispatch", async (boundary) => {
		vi.stubEnv("PI_TASKS_COMPACTION_COHORT", "pilot");
		const h = await createNativeSession();
		const runner = h.session.extensionRunner;
		const errors: unknown[] = [];
		const stopErrors = runner.onError((error: unknown) => errors.push(error));
		const send = vi
			.spyOn(h.session, "sendCustomMessage")
			.mockResolvedValue(undefined);
		const usage = vi.spyOn(h.session, "getContextUsage").mockReturnValue({
			tokens: 150_000,
			contextWindow: 1_000_000,
			percent: 15,
		});
		const pending = vi
			.spyOn(h.session, "pendingMessageCount", "get")
			.mockReturnValue(0);
		let finish: ((value: unknown) => void) | undefined;
		let completion: Promise<unknown> | undefined;
		const compact = vi.spyOn(h.session, "compact").mockImplementation(() => {
			completion = new Promise((resolve) => {
				finish = resolve;
			});
			return completion;
		});
		try {
			execFileSync("git", ["init", "-b", "pilot"], {
				cwd: h.cwd,
				stdio: "pipe",
			});
			execFileSync(
				"git",
				[
					"-c",
					"user.name=Test",
					"-c",
					"user.email=test@example.com",
					"commit",
					"--allow-empty",
					"-m",
					"fixture",
				],
				{ cwd: h.cwd, stdio: "pipe" },
			);
			h.sessionManager.appendMessage({
				role: "user",
				content: "Implement bounded fixture",
				timestamp: Date.now(),
			});
			appendNativeToolCall(h.sessionManager);
			await requireTool(h.session, "task_plan").execute("plan", validPlan());
			await runner.emitToolResult({
				type: "tool_result",
				toolName: "task_plan",
				toolCallId: "plan",
				input: validPlan(),
				content: [],
				details: { taskId: "T1" },
				isError: false,
			});
			const sessionId = h.sessionManager.getSessionId();
			// Check both admission suppression and an interruption after dispatch.
			if (boundary === "pending") pending.mockReturnValue(1);
			if (boundary === "live-child")
				h.eventBus.emit("subagent:async-started", {
					sessionId,
					id: "existing-run",
				});
			if (boundary === "pending" || boundary === "live-child") {
				await runner.emit({ type: "agent_settled", aborted: false });
				expect(compact).not.toHaveBeenCalled();
				pending.mockReturnValue(0);
				h.eventBus.emit("subagent:async-complete", {
					sessionId,
					runId: "existing-run",
				});
			}
			await runner.emit({ type: "agent_settled", aborted: false });
			expect(compact).toHaveBeenCalledTimes(1);
			if (boundary === "pending") pending.mockReturnValue(1);
			else if (boundary === "live-child")
				h.eventBus.emit("subagent:async-started", {
					sessionId,
					id: "existing-run",
				});
			else
				await runner.emit({
					type: boundary,
					text: "redirect",
					source: "interactive",
					reason: "quit",
				});
			finish?.({
				summary: "fixture",
				firstKeptEntryId: "fixture",
				tokensBefore: 150_000,
			});
			await completion;
			// Drain the real context callback, without starting any provider request.
			await Promise.resolve();
			expect(send).not.toHaveBeenCalled();
			expect(errors).toEqual([]);
		} finally {
			compact.mockRestore();
			pending.mockRestore();
			usage.mockRestore();
			send.mockRestore();
			stopErrors();
			h.session.dispose();
			vi.unstubAllEnvs();
		}
	});
});

describe("native Pi telemetry companion", () => {
	it("receives explicit markers and native SDK lifecycle dispatch without compaction decisions", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-native-telemetry-"));
		cleanups.push(directory);
		const previous = process.env.PI_TASKS_TELEMETRY_DIR;
		process.env.PI_TASKS_TELEMETRY_DIR = directory;
		const h = await createNativeSession({ telemetry: true });
		try {
			const { TelemetryStore } = await import("../src/compaction-telemetry.ts");
			const runner = h.session.extensionRunner;
			const errors: unknown[] = [];
			const stopErrors = runner.onError((error: unknown) => errors.push(error));
			h.eventBus.emit("pi-tasks:phase", {
				version: 1,
				id: "native-phase",
				kind: "phase_start",
				phaseId: "verification",
				taskId: "T1",
			});
			const result = await runner.emit({
				type: "session_before_compact",
				reason: "threshold",
				willRetry: false,
				preparation: {
					tokensBefore: 125000,
					settings: { reserveTokens: 80000, keepRecentTokens: 20000 },
				},
				branchEntries: [],
				signal: new AbortController().signal,
			});
			expect(result?.cancel).not.toBe(true);
			expect(result?.compaction).toBeUndefined();
			await runner.emit({
				type: "session_compact",
				reason: "threshold",
				willRetry: false,
				fromExtension: false,
				compactionEntry: {
					id: "native-entry",
					timestamp: new Date().toISOString(),
					tokensBefore: 125000,
				},
			});
			const message = {
				role: "assistant",
				timestamp: 1,
				stopReason: "stop",
				content: [],
				usage: { input: 20, output: 2 },
			};
			await runner.emitMessageEnd({ type: "message_end", message });
			await runner.emitMessageEnd({
				type: "message_end",
				message: { ...message, timestamp: 2 },
			});
			await runner.emit({ type: "session_shutdown", reason: "quit" });
			const records = new TelemetryStore(directory).read().records;
			expect(
				records.filter((record) => record.kind === "compaction_end"),
			).toHaveLength(1);
			expect(records.filter((record) => record.kind === "usage")).toHaveLength(
				2,
			);
			expect(records.some((record) => record.kind === "phase_start")).toBe(
				true,
			);
			expect(records.some((record) => record.kind === "session_end")).toBe(
				true,
			);
			expect(errors).toEqual([]);
			stopErrors();
		} finally {
			h.session.dispose();
			if (previous === undefined) delete process.env.PI_TASKS_TELEMETRY_DIR;
			else process.env.PI_TASKS_TELEMETRY_DIR = previous;
		}
	});
});

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

	it("enforces task_evidence text limits through the native Pi validator", async () => {
		const active = await createNativeSession();
		try {
			await requireTool(active.session, "task_plan").execute(
				"native-evidence-plan",
				validPlan(),
				undefined,
				undefined,
			);
			const evidence = requireTool(active.session, "task_evidence");
			const argumentsAtBoundary = {
				task_id: "T1",
				type: "test",
				level: "unit_test",
				summary: "native validator accepted the evidence boundary",
				passed: "true",
				references: ["npm test"],
				step_ids: ["T1-S1"],
				quality: {
					source: "native validator",
					reproducible: true,
					verifier: "tool",
					command: "x".repeat(300),
					artifactRefs: ["npm test"],
					observedOutput: "Tests 1 passed (1)",
				},
			};

			expect(
				piAi.validateToolArguments(evidence, {
					name: "task_evidence",
					arguments: argumentsAtBoundary,
				}),
			).toMatchObject(argumentsAtBoundary);
			expect(() =>
				piAi.validateToolArguments(evidence, {
					name: "task_evidence",
					arguments: {
						...argumentsAtBoundary,
						quality: {
							...argumentsAtBoundary.quality,
							command: "x".repeat(301),
						},
					},
				}),
			).toThrow(/quality\.command.*300/);
		} finally {
			active.session.dispose();
		}
	});

	it("returns a native-valid evidence retry and restores the corrected evidence", async () => {
		const active = await createNativeSession();
		try {
			appendNativeToolCall(active.sessionManager);
			await requireTool(active.session, "task_plan").execute(
				"native-evidence-retry-plan",
				validPlan(),
				undefined,
				undefined,
			);
			const evidence = requireTool(active.session, "task_evidence");
			const persistedBefore = active.sessionManager
				.getEntries()
				.filter(
					(entry: { type: string; customType?: string }) =>
						entry.type === "custom" && entry.customType === "pi-tasks:event",
				).length;
			const rejected = await evidence.execute(
				"native-evidence-rejected",
				{
					task_id: "T1",
					type: "test",
					level: "not_verified",
					summary: "test run reported 7 passed",
					passed: "true",
					references: ["npm test"],
					step_ids: ["T1-S1"],
					quality: {
						source: "native test fixture",
						reproducible: true,
						verifier: "tool",
						command: "npm test",
						artifactRefs: ["npm test"],
						observedOutput: "Tests 7 passed (7)",
					},
				},
				undefined,
				undefined,
			);
			expect(rejected.isError).toBe(true);
			expect(rejected.details).toMatchObject({
				retry_example: {
					type: "test",
					quality: {
						command: "npm test",
					},
				},
			});
			expect(
				active.sessionManager
					.getEntries()
					.filter(
						(entry: { type: string; customType?: string }) =>
							entry.type === "custom" && entry.customType === "pi-tasks:event",
					),
			).toHaveLength(persistedBefore);

			assert.ok(rejected.details && typeof rejected.details === "object");
			assert.ok("retry_example" in rejected.details);
			const retryExample = rejected.details.retry_example;
			assert.ok(retryExample && typeof retryExample === "object");
			const correctedParams = {
				...(retryExample as Record<string, unknown>),
				level: "unit_test",
			};
			expect(
				piAi.validateToolArguments(evidence, {
					name: "task_evidence",
					arguments: correctedParams,
				}),
			).toMatchObject(correctedParams);
			const corrected = await evidence.execute(
				"native-evidence-corrected",
				correctedParams,
				undefined,
				undefined,
			);
			expect(corrected.isError).not.toBe(true);
			const sessionFile = active.sessionManager.getSessionFile();
			assert.ok(sessionFile);
			await waitForPersistedTaskEvent(sessionFile, "task.evidence_added");

			active.session.dispose();
			const restored = await createNativeSession({
				base: active.base,
				sessionFile,
			});
			try {
				const listed = await requireTool(restored.session, "task_list").execute(
					"native-evidence-list",
					{ include_evidence: true },
					undefined,
					undefined,
				);
				expect(listed.content[0]?.text).toContain("test run reported 7 passed");
			} finally {
				restored.session.dispose();
			}
		} finally {
			active.session.dispose();
		}
	});

	it("persists only corrected native scope updates after targeted recovery", async () => {
		const active = await createNativeSession();
		try {
			appendNativeToolCall(active.sessionManager);
			await requireTool(active.session, "task_plan").execute(
				"native-scope-plan",
				validPlan(),
				undefined,
				undefined,
			);
			const update = requireTool(active.session, "task_update");
			const persistedBefore = active.sessionManager
				.getEntries()
				.filter(
					(entry: { type: string; customType?: string }) =>
						entry.type === "custom" && entry.customType === "pi-tasks:event",
				).length;

			const rejected = await update.execute(
				"native-scope-rejected",
				{ task_id: "T1", scope: "within_step" },
				undefined,
				undefined,
			);
			expect(rejected.isError).toBe(true);
			expect(rejected.content[0]?.text).toContain("retry_with: task_update");
			expect(rejected.details).toMatchObject({
				retry_with: "task_update",
				minimum_params: {
					activity: "<meaningful activity performed>",
					scope: "within_step",
				},
			});
			expect(
				active.sessionManager
					.getEntries()
					.filter(
						(entry: { type: string; customType?: string }) =>
							entry.type === "custom" && entry.customType === "pi-tasks:event",
					),
			).toHaveLength(persistedBefore);

			const corrected = await update.execute(
				"native-scope-corrected",
				{
					task_id: "T1",
					activity: "Inspected the current fixture",
					scope: "within_step",
				},
				undefined,
				undefined,
			);
			expect(corrected.isError).not.toBe(true);
			const sessionFile = active.sessionManager.getSessionFile();
			assert.ok(sessionFile);
			await waitForPersistedTaskEvent(sessionFile, "task.updated");
			expect(
				active.sessionManager
					.getEntries()
					.filter(
						(entry: { type: string; customType?: string }) =>
							entry.type === "custom" && entry.customType === "pi-tasks:event",
					),
			).toHaveLength(persistedBefore + 1);
		} finally {
			active.session.dispose();
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
