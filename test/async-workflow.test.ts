import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import taskExtension from "../index.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	SettlementEvent,
	SettlementResult,
	ToolDefinition,
} from "../src/pi-types.ts";
import type { BranchEntry } from "../src/store.ts";

// Like test:native, this gate requires explicit local dependencies, never downloads.
const producerRoot = process.env.PI_SUBAGENTS_ROOT;
const installedRoot = process.env.PI_TASKS_INSTALLED_ROOT;
if (!producerRoot || !installedRoot) {
	throw new Error(
		"PI_SUBAGENTS_ROOT and PI_TASKS_INSTALLED_ROOT are required; this gate must not skip.",
	);
}
const producerRevision = "176b896505b4063c8f0d08f24e81290a33e3f94d";
expect(
	execFileSync("git", ["-C", producerRoot, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
).toBe(producerRevision);
expect(
	execFileSync(
		"git",
		["-C", producerRoot, "status", "--porcelain", "--", "src"],
		{ encoding: "utf8" },
	).trim(),
).toBe("");
const producerSourceRoot = join(producerRoot, "src");
const loadProducer = (path: string) =>
	import(pathToFileURL(join(producerSourceRoot, path)).href);
const {
	default: registerSubagentNotify,
	createCompletionSendRegistry,
	parseSubagentNotifyContent,
} = await loadProducer("runs/background/notify.ts");
const { handleSubagentControlNotice } = await loadProducer(
	"extension/control-notices.ts",
);
const { buildControlEvent } = await loadProducer(
	"runs/shared/subagent-control.ts",
);
const { createParentWake, PARENT_WAKE_TEXT } = await loadProducer(
	"shared/parent-wake.ts",
);
const { resolveCurrentSessionId } = await loadProducer(
	"shared/session-identity.ts",
);
const constants = await loadProducer("shared/types.ts");
expect(
	createHash("sha256")
		.update(readFileSync(join(installedRoot, "dist/index.js")))
		.digest("hex"),
).toBe("0a02082eb2b87d6f99e9d400357f507f15c5ff8dabacaea02eb72f9505273ce5");
const { default: candidateExtension } = await import("../dist/index.js");
const { default: installedExtension } = await import(
	pathToFileURL(join(installedRoot, "dist/index.js")).href
);

// Execute the exact emission call, not a hand-maintained approximation of its
// payload. The surrounding process/filesystem orchestration is intentionally out
// of scope; see docs/async-workflow-verification.md for these injection boundaries.
function emission(
	file: string,
	receiver: string,
	event: string,
	distinguishingText: string,
) {
	const source = ts.createSourceFile(
		file,
		readFileSync(join(producerSourceRoot, file), "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const matches: string[] = [];
	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			node.expression.getText(source) === receiver &&
			node.arguments[0]?.getText(source) === event &&
			node.getText(source).includes(distinguishingText)
		) {
			matches.push(node.getText(source));
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	expect(matches).toHaveLength(1);
	const call = matches[0];
	if (!call) throw new Error(`Missing ${receiver} in ${file}`);
	const code = ts.transpileModule(call, {
		compilerOptions: { target: ts.ScriptTarget.ES2023 },
	}).outputText;
	return (scope: Record<string, unknown>) =>
		runInNewContext(code, { ...constants, ...scope });
}
const executor = "runs/foreground/subagent-executor.ts";
const rootStarted = emission(
	executor,
	"deps.pi.events.emit",
	"SUBAGENT_ASYNC_STARTED_EVENT",
	'mode: "workflow"',
);
const childStarted = emission(
	"runs/background/async-execution.ts",
	"ctx.pi.events.emit",
	"SUBAGENT_ASYNC_STARTED_EVENT",
	'mode: "single"',
);
const childCompleted = emission(
	executor,
	"pi.events.emit",
	"SUBAGENT_ASYNC_COMPLETE_EVENT",
	"awaitedByWorkflow: true",
);
const rootCompleted = emission(
	"runs/background/result-watcher.ts",
	"pi.events.emit",
	"SUBAGENT_ASYNC_COMPLETE_EVENT",
	"normalizedChildren",
);
const sessionUuid = "00000000-0000-4000-8000-000000000001";
const sessionFile = `/sessions/${sessionUuid}.jsonl`;
const completionOwnerId = "workflow-test-owner";

type Notice = { customType: string; content: string };
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
function harness(
	extension: typeof taskExtension,
	producerFirst: boolean,
	persisted = true,
) {
	const entries: BranchEntry[] = [];
	const handlers = new Map<string, Handler[]>();
	const observers = new Map<string, Set<(data: unknown) => void>>();
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const notices: Array<{ message: Notice; options: unknown }> = [];
	const wakes: Array<{ content: string; options: unknown }> = [];
	const events = {
		on(name: string, handler: (data: unknown) => void) {
			const listeners = observers.get(name) ?? new Set();
			listeners.add(handler);
			observers.set(name, listeners);
			return () => {
				listeners.delete(handler);
			};
		},
		emit(name: string, data: unknown) {
			for (const handler of observers.get(name) ?? []) handler(data);
		},
	};
	const pi: ExtensionAPI = {
		events,
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler as Handler);
			handlers.set(name, list);
		},
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
		appendEntry(customType, data) {
			entries.push({ type: "custom", customType, data });
		},
		sendMessage() {
			throw new Error("pi-tasks must not queue a yield follow-up");
		},
	};
	const sessionManager = {
		getBranch: () => entries,
		getSessionId: () => sessionUuid,
		getSessionFile: () => (persisted ? sessionFile : undefined),
	};
	const sessionId = resolveCurrentSessionId(sessionManager);
	expect(sessionId).toBe(persisted ? sessionFile : sessionUuid);
	if (persisted) expect(sessionId).not.toBe(sessionManager.getSessionId());
	const ctx: ExtensionContext = {
		sessionManager,
		hasPendingMessages: () => wakes.length > 0,
		ui: { notify() {}, setStatus() {}, setWidget() {} },
	};
	const state = { currentSessionId: sessionId, completionOwnerId };
	const wake = createParentWake(
		{
			sendMessage(message: Notice, options: unknown) {
				notices.push({ message, options });
			},
			sendUserMessage(content: string, options: unknown) {
				wakes.push({ content, options });
			},
		},
		() => 1_000,
	);
	wake.bindSession({ sessionManager: ctx.sessionManager, isIdle: () => true });
	const visibleControlNotices = new Set<string>();
	const registerProducer = () => {
		const notifier = registerSubagentNotify(
			{ events, sendMessage: wake.sendMessage },
			state,
			{
				batchConfig: { enabled: false },
				sendRegistry: createCompletionSendRegistry(),
			},
		);
		const unsubscribe = events.on(
			constants.SUBAGENT_CONTROL_EVENT,
			(details) => {
				handleSubagentControlNotice({
					pi: wake,
					state,
					visibleControlNotices,
					details,
				});
			},
		);
		return { notifier, unsubscribe };
	};
	const producer = producerFirst ? registerProducer() : undefined;
	extension(pi);
	const { notifier, unsubscribe } = producer ?? registerProducer();
	const emit = async (name: string, event: unknown = {}) => {
		let result: unknown;
		for (const handler of handlers.get(name) ?? [])
			result = await handler(event, ctx);
		return result;
	};
	const execute = async (name: string, input: Record<string, unknown>) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`Missing tool ${name}`);
		const result = await tool.execute(
			"test-call",
			input,
			undefined,
			undefined,
			ctx,
		);
		expect(result.isError).not.toBe(true);
		await emit("tool_result", {
			toolName: name,
			input,
			details: result.details,
			isError: false,
		});
	};
	const startRoot = () =>
		rootStarted({
			deps: { pi },
			workflowRunId: "workflow-root",
			asyncDir: "/unused/workflow-root",
			workflowCwd: "/unused",
			workflowSessionRoot: undefined,
			process: { pid: 123 },
			currentSessionId: sessionId,
			completionOwnerId,
			derivedObjective: "",
			timeout: undefined,
		});
	const startChild = () =>
		childStarted({
			ctx: { pi, currentSessionId: sessionId, completionOwnerId },
			id: "workflow-child",
			spawnResult: { pid: 124 },
			agent: "reviewer",
			task: "",
			params: {
				goal: "",
				parentWorkflowRunId: "workflow-root",
				workflowKey: "review",
			},
			runnerCwd: "/unused",
			asyncDir: "/unused/workflow-child",
			sessionRoot: undefined,
			launchContractDigest: "test-digest",
			launchResolvedExtensions: [],
			timeoutMs: undefined,
			initialUsageBudget: undefined,
			capabilityCeiling: undefined,
			nestedRoute: undefined,
		});
	return {
		pi,
		emit,
		execute,
		notices,
		wakes,
		startRoot,
		startChild,
		async arm() {
			await execute("task_update", {
				task_id: "T1",
				next_action: "Apply workflow review findings",
			});
		},
		async create() {
			await emit("session_start");
			await execute("task_plan", {
				title: "Verify workflow lifecycle",
				objective: "Verify workflow advisory suppression",
				acceptance_criteria: ["Lifecycle assertions pass"],
				plan_steps: [
					{
						text: "Implement workflow regression",
						expectedOutput: "Verified workflow regression",
						allowedActions: ["edit", "test"],
						decompositionStatus: "atomic",
						granularityCheck: {
							isAtomic: true,
							reason: "One bounded regression deliverable",
							unit: "deliverable",
							boundedScope: "Workflow lifecycle test seam",
							verificationPlan: "Run deterministic lifecycle assertions",
							canBeDoneInOneAgentAction: true,
							hasSingleObservableOutput: true,
							hasSingleVerificationMethod: true,
							hasNoHiddenSubtasks: true,
						},
					},
				],
			});
		},
		settle: () =>
			emit("agent_before_settle", {
				outcome: "completed",
				continue: false,
				context: { canContinue: false, pendingMessages: [] },
			} satisfies SettlementEvent) as Promise<SettlementResult | undefined>,
		completeChild(completedSessionId = sessionId) {
			childCompleted({
				pi,
				state,
				runId: "workflow-child",
				asyncDir: "/unused/workflow-child",
				parentWorkflowRunId: "workflow-root",
				status: { sessionId: completedSessionId, completionOwnerId },
				completed: { agent: "reviewer", success: true },
			});
		},
		attention() {
			events.emit(constants.SUBAGENT_CONTROL_EVENT, {
				source: "async",
				event: buildControlEvent({
					runId: "workflow-child",
					agent: "reviewer",
					to: "needs_attention",
					reason: "supervisor_request",
					currentTool: "contact_supervisor",
					toolCallId: "decision",
					ts: 1_000,
					message: "Review requires a scope decision",
				}),
			});
		},
		async completeRoot() {
			const data = {
				id: "workflow-root",
				sessionId,
				completionOwnerId,
				mode: "workflow",
				agent: "workflow",
				state: "complete",
				success: true,
				summary: "Workflow review completed",
			};
			// The result watcher delivers before publishing completion, then the bus
			// notification path deduplicates that same result (not a second wake).
			expect(
				await notifier.deliver({
					...data,
					runId: data.id,
					triggerTurn: true,
					intercomDelivered: false,
				}),
			).toBe(true);
			rootCompleted({
				pi,
				data,
				runId: data.id,
				triggerTurn: true,
				intercomDelivered: false,
				nestedChildren: undefined,
			});
		},
		consumeWake() {
			wakes.length = 0;
			wake.agentStarted();
		},
		async dispose() {
			notifier.dispose();
			unsubscribe();
			wake.sessionShutdown("quit");
			await emit("session_shutdown");
		},
	};
}

for (const [label, extension] of [
	["source", taskExtension],
	["candidate dist", candidateExtension],
] as const) {
	describe.each([false, true])(
		`${label} with pi-subagents ${producerRevision.slice(0, 8)} (persisted=%s)`,
		(persisted) => {
			for (const producerFirst of [true, false]) {
				it(`suppresses workflow waits but delivers genuine notifications (producer first=${producerFirst})`, async () => {
					const h = harness(extension, producerFirst, persisted);
					try {
						await h.create();
						h.startRoot();
						expect(await h.settle()).toBeUndefined();
						h.startChild();
						await h.emit("input");
						await h.emit("session_tree");
						await h.arm();
						for (let boundary = 0; boundary < 3; boundary++)
							expect(await h.settle()).toBeUndefined();
						h.attention();
						h.attention();
						expect(h.notices).toHaveLength(1);
						expect(h.notices[0]?.message.customType).toBe(
							"subagent_control_notice",
						);
						expect(h.notices[0]?.message.content).toContain(
							"Review requires a scope decision",
						);
						expect(h.wakes).toEqual([
							{ content: PARENT_WAKE_TEXT, options: { deliverAs: "steer" } },
						]);
						expect(await h.settle()).toBeUndefined();
						h.consumeWake();
						await h.emit("input");
						await h.arm();
						expect(await h.settle()).toBeUndefined();
						h.completeChild();
						expect(h.notices).toHaveLength(1); // Awaited children belong to the workflow.
						expect(h.wakes).toHaveLength(0);
						expect(await h.settle()).toBeUndefined(); // Root still running.
						await h.completeRoot();
						expect(h.notices).toHaveLength(2);
						expect(h.notices[1]?.message.customType).toBe("subagent-notify");
						expect(
							parseSubagentNotifyContent(h.notices[1]?.message.content)?.status,
						).toBe("completed");
						expect(h.notices[1]?.message.content).toContain(
							"Workflow review completed",
						);
						expect(h.notices.map((notice) => notice.options)).toEqual([
							{ triggerTurn: false },
							{ triggerTurn: false },
						]);
						expect(h.wakes).toHaveLength(1);
						expect(await h.settle()).toBeUndefined(); // Completion wake has precedence.
						h.consumeWake();
						await h.emit("input");
						await h.arm();
						expect((await h.settle())?.continue).toBe(true);
						expect(await h.settle()).toBeUndefined();
					} finally {
						await h.dispose();
					}
				});
			}
			it("retains a tracked child after root completion and ignores foreign completion", async () => {
				const h = harness(extension, false, persisted);
				try {
					await h.create();
					h.startRoot();
					h.startChild();
					await h.completeRoot();
					h.consumeWake();
					await h.emit("input");
					await h.arm();
					expect(await h.settle()).toBeUndefined();
					h.completeChild("foreign-session");
					expect(await h.settle()).toBeUndefined();
					h.completeChild();
					expect((await h.settle())?.continue).toBe(true);
					expect(h.notices).toHaveLength(1);
				} finally {
					await h.dispose();
				}
			});
			it("offers one ordinary advisory without active async work", async () => {
				const h = harness(extension, false, persisted);
				try {
					await h.create();
					const result = await h.settle();
					expect(result?.continue).toBe(true);
					expect(result?.entries).toMatchObject([
						{ customType: "pi-tasks:yield-check" },
					]);
					expect(await h.settle()).toBeUndefined();
					expect(h.notices).toHaveLength(0);
					expect(h.wakes).toHaveLength(0);
				} finally {
					await h.dispose();
				}
			});
		},
	);
}

// This read-only installed artifact is the known unfixed baseline, not a candidate
// acceptance target. Keep the control explicit instead of changing its files.
it.each([false, true])(
	"reproduces installed baseline identity mismatch (persisted=%s)",
	async (persisted) => {
		const h = harness(installedExtension, false, persisted);
		try {
			await h.create();
			h.startRoot();
			expect(Boolean((await h.settle())?.continue)).toBe(persisted);
		} finally {
			await h.dispose();
		}
	},
);
