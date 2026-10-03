import { describe, expect, it } from "vitest";
import taskExtension from "../../index.ts";
import { createContinuationAdvisory } from "../../src/continuation.ts";
import {
	TASK_EVENT_CUSTOM_TYPE,
	type TaskEvent,
	type TaskStatus,
} from "../../src/model.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	SettlementEvent,
	SettlementResult,
	ToolDefinition,
} from "../../src/pi-types.ts";
import { replayBranchEntries } from "../../src/store.ts";

const created: TaskEvent = {
	version: 1,
	id: "created",
	type: "task.created",
	taskId: "T1",
	createdAt: "2026-09-15T00:00:00.000Z",
	source: "tool",
	title: "Review implementation",
	objective: "Verify the implementation",
	acceptanceCriteria: ["Review has evidence"],
	planSteps: [
		{
			text: "Inspect implementation",
			expectedOutput: "Independent review findings",
			allowedActions: ["read"],
			evidenceRequired: true,
			decompositionStatus: "atomic",
			granularityCheck: {
				isAtomic: true,
				reason: "One independent inspection with one review artifact",
				canBeDoneInOneAgentAction: true,
				hasSingleObservableOutput: true,
				hasSingleVerificationMethod: true,
				hasNoHiddenSubtasks: true,
			},
		},
	],
	activate: true,
};
const branch = [
	{ type: "custom", customType: TASK_EVENT_CUSTOM_TYPE, data: created },
];
const state = () => replayBranchEntries(branch).state;

function armed() {
	const advisory = createContinuationAdvisory();
	const current = state();
	advisory.observeToolResult("task_verify_step", false, { task_id: "T1" });
	return { advisory, current };
}

function harness() {
	const handlers = new Map<
		string,
		(event: unknown, ctx: ExtensionContext) => unknown
	>();
	const messages: SettlementResult["entries"] = [];
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const observers = new Map<string, Set<(data: unknown) => void>>();
	const entries = structuredClone(branch);
	const pi: ExtensionAPI = {
		events: {
			emit: (name, data) => {
				for (const handler of observers.get(name) ?? []) handler(data);
			},
			on: (name, handler) => {
				const listeners = observers.get(name) ?? new Set();
				listeners.add(handler);
				observers.set(name, listeners);
				return () => {
					listeners.delete(handler);
				};
			},
		},
		on: (name, handler) => {
			handlers.set(
				name,
				handler as (event: unknown, ctx: ExtensionContext) => unknown,
			);
		},
		registerTool: (tool) => {
			tools.set(tool.name, tool);
		},
		registerCommand: () => {},
		appendEntry: () => {},
		sendMessage: () => {
			throw new Error("Yield checks must not enqueue messages");
		},
	};
	const ctx: ExtensionContext = {
		sessionManager: {
			getBranch: () => entries,
			getSessionId: () => "session-1",
		},
		hasPendingMessages: () => false,
		ui: { notify: () => {}, setWidget: () => {}, setStatus: () => {} },
	};
	taskExtension(pi);
	const emit = async (name: string, event: unknown = {}) => {
		return await handlers.get(name)?.(event, ctx);
	};
	const settle = async (overrides: Partial<SettlementEvent> = {}) => {
		const result = (await emit("agent_before_settle", {
			outcome: "completed",
			continue: false,
			context: { canContinue: false, pendingMessages: [] },
			...overrides,
		} satisfies SettlementEvent)) as SettlementResult | undefined;
		if (result) messages.push(...result.entries);
		return result;
	};
	const execute = async (name: string, input: Record<string, unknown>) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`Missing tool ${name}`);
		const result = await tool.execute("call", input, undefined, undefined, ctx);
		expect(result.isError).not.toBe(true);
		await emit("tool_result", {
			toolName: name,
			isError: false,
			input,
			details: result.details,
		});
		return result;
	};
	const turn = async (
		stopReason = "stop",
		toolName?: string,
		isError = false,
	) => {
		if (toolName)
			await emit("tool_result", {
				toolName,
				isError,
				input: { task_id: "T1" },
			});
		await emit("turn_end", {
			message: { role: "assistant", stopReason },
		});
	};
	return { pi, ctx, messages, emit, turn, settle, execute, observers };
}

describe("bounded continuation policy", () => {
	it("arms the advisory for a repair-only input", () => {
		const { advisory, current } = armed();
		advisory.reset();
		advisory.observeToolResult("task_replan", false, { task_id: "T1" });
		expect(advisory.take(current)).toContain("Recommended tool:");
		expect(advisory.take(current)).toBeUndefined();
	});
	it("treats unrun review/validation as actionable and reuses resume guidance", () => {
		const { advisory, current } = armed();
		const content = advisory.take(current);
		expect(content).toContain("T1-S1 Inspect implementation");
		expect(content).toContain("Recommended tool: task_verify_step");
		expect(content).toContain('"step_id":"T1-S1"');
		expect(content).toContain("prerequisite not yet performed");
		expect(content).toContain("Do not bypass");
		expect(content).toContain("create a PR unless requested");
	});

	it("also nudges decomposition rather than requiring an atomic step first", () => {
		const { advisory, current } = armed();
		current.tasks.T1.planSteps[0].decompositionStatus = "needs_breakdown";
		expect(advisory.take(current)).toContain(
			"Recommended tool: task_decompose",
		);
	});

	it("does not re-arm after more progress in its own follow-up", () => {
		const { advisory, current } = armed();
		expect(advisory.take(current)).toBeDefined();
		advisory.observeToolResult("task_update", false, { task_id: "T1" });
		expect(advisory.take(current)).toBeUndefined();
		advisory.reset();
		expect(advisory.take(current)).toBeUndefined();
		advisory.observeToolResult("task_update", false, { task_id: "T1" });
		expect(advisory.take(current)).toBeDefined();
	});

	it.each<TaskStatus>(["pending", "blocked", "review", "done", "cancelled"])(
		"respects %s status",
		(status) => {
			const { advisory, current } = armed();
			current.tasks.T1.status = status;
			expect(advisory.take(current)).toBeUndefined();
		},
	);

	it.each([
		"user",
		"external",
		"environment",
		"dependency",
		"ambiguity",
	] as const)(
		"respects unresolved %s blockers even with active status",
		(blockedBy) => {
			const { advisory, current } = armed();
			current.tasks.T1.blockers.push({
				id: "B1",
				reason: "Approval or capability needed",
				blockedBy,
				neededToUnblock: "Owner supplies decision or capability",
				createdAt: created.createdAt,
			});
			expect(advisory.take(current)).toBeUndefined();
			current.tasks.T1.blockers[0].resolvedAt = created.createdAt;
			expect(advisory.take(current)).toBeDefined();
		},
	);

	it("does not turn exhausted plans or stale task identities into completion pressure", () => {
		const { advisory, current } = armed();
		current.tasks.T1.planSteps[0].status = "done";
		expect(advisory.take(current)).toBeUndefined();
		current.activeTaskId = undefined;
		expect(advisory.take(current)).toBeUndefined();
	});

	it.each([
		"task_resume",
		"task_list",
		"task_focus",
		"task_next",
		"task_checkpoint",
		"task_decision",
		"read",
		"bash",
	])("does not arm from %s alone", (name) => {
		const advisory = createContinuationAdvisory();
		const current = state();
		advisory.observeToolResult(name, false, { task_id: "T1" });
		expect(advisory.take(current)).toBeUndefined();
	});

	it("does not arm from rejected execution calls", () => {
		const advisory = createContinuationAdvisory();
		const current = state();
		advisory.observeToolResult("task_update", true, { task_id: "T1" });
		expect(advisory.take(current)).toBeUndefined();
	});
});

describe("affected-task association", () => {
	it("does not arm stale T1 when task_plan creates inactive T2", () => {
		const { advisory, current } = armed();
		advisory.reset();
		advisory.observeToolResult(
			"task_plan",
			false,
			{ activate: false },
			{ taskId: "T1" },
		);
		expect(advisory.take(current)).toBeUndefined();
	});

	it.each([
		"task_update",
		"task_decompose",
		"task_rework",
		"task_replan",
		"task_evidence",
		"task_verify_step",
	])(
		"binds %s to its target even when the result resumes another task",
		(name) => {
			const { advisory, current } = armed();
			advisory.observeToolResult(
				name,
				false,
				{ task_id: "T2" },
				{ taskId: "T1" },
			);
			expect(advisory.take(current)).toBeUndefined();
		},
	);

	it.each([{}, { activate: true }])(
		"arms active creation from its own result contract: %j",
		(input) => {
			const { advisory, current } = armed();
			advisory.reset();
			advisory.observeToolResult("task_plan", false, input, { taskId: "T1" });
			expect(advisory.take(current)).toBeDefined();
		},
	);

	it("does not bind an earlier active creation to a later active task", () => {
		const { advisory, current } = armed();
		advisory.observeToolResult("task_plan", false, {}, { taskId: "T2" });
		expect(advisory.take(current)).toBeUndefined();
	});

	it.each([undefined, null, {}, { taskId: 42 }])(
		"declines missing or malformed creation identity: %j",
		(details) => {
			const { advisory, current } = armed();
			advisory.observeToolResult("task_plan", false, {}, details);
			expect(advisory.take(current)).toBeUndefined();
		},
	);

	it("does not infer a missing explicit mutation target from active state", () => {
		const { advisory, current } = armed();
		advisory.observeToolResult("task_update", false, {}, { taskId: "T1" });
		expect(advisory.take(current)).toBeUndefined();
	});
});

describe("extension lifecycle integration", () => {
	it("passes inactive task creation arguments into the association policy", async () => {
		const h = harness();
		await h.emit("session_start");
		await h.emit("tool_result", {
			toolName: "task_plan",
			isError: false,
			input: { activate: false },
			details: { taskId: "T1" },
		});
		await h.settle();
		expect(h.messages).toHaveLength(0);
	});

	it("returns one atomic continuation at settlement, never at turn end", async () => {
		const h = harness();
		await h.emit("session_start");
		await h.turn("toolUse", "task_update");
		expect(h.messages).toHaveLength(0);
		await h.turn();
		expect(h.messages).toHaveLength(0);
		const result = await h.settle();
		expect(result?.continue).toBe(true);
		expect(h.messages).toHaveLength(1);
		expect(h.messages[0].customType).toBe("pi-tasks:yield-check");
		await h.turn("toolUse", "task_update");
		await h.settle();
		expect(h.messages).toHaveLength(1);
	});

	it.each(["input", "session_tree", "session_start", "session_shutdown"])(
		"%s disarms previous task work",
		async (name) => {
			const h = harness();
			await h.emit("session_start");
			await h.turn("toolUse", "task_update");
			await h.emit(name);
			await h.settle();
			expect(h.messages).toHaveLength(0);
		},
	);

	it("leaves explanation-only task queries alone despite a replayed active task", async () => {
		const h = harness();
		await h.emit("session_start");
		await h.turn("toolUse", "task_resume");
		await h.settle();
		expect(h.messages).toHaveLength(0);
	});

	it.each(["aborted", "error"] as const)(
		"does not restart a %s settlement",
		async (reason) => {
			const h = harness();
			await h.emit("session_start");
			await h.turn("toolUse", "task_update");
			await h.settle({ outcome: reason });
			expect(h.messages).toHaveLength(0);
		},
	);

	it("respects cancellation and queued work", async () => {
		const h = harness();
		await h.emit("session_start");
		await h.turn("toolUse", "task_update");
		h.ctx.signal = AbortSignal.abort();
		await h.settle();
		expect(h.messages).toHaveLength(0);
		h.ctx.signal = undefined;
		h.ctx.hasPendingMessages = () => true;
		await h.settle();
		expect(h.messages).toHaveLength(0);
	});

	it("uses the boundary without optional message-delivery APIs", async () => {
		const h = harness();
		await h.emit("session_start");
		await h.turn("toolUse", "task_update");
		h.pi.sendMessage = undefined;
		h.ctx.hasPendingMessages = undefined;
		await h.settle();
		expect(h.messages).toHaveLength(1);
	});

	it.each([
		{ continue: true },
		{ context: { canContinue: true, pendingMessages: [{}] } },
	])("defers to existing boundary work: %j", async (boundary) => {
		const h = harness();
		await h.emit("session_start");
		await h.turn("stop", "task_update");
		await h.settle(boundary);
		expect(h.messages).toHaveLength(0);
		await h.settle();
		expect(h.messages).toHaveLength(1);
	});

	const reviewEvidence = {
		task_id: "T1",
		step_id: "T1-S1",
		type: "review",
		level: "static_read",
		summary: "Independent review passed",
		references: ["review.json"],
		quality: {
			source: "reviewer",
			reproducible: true,
			verifier: "tool",
			command: "review staged tree",
			artifactRefs: ["review.json"],
			observedOutput: "No findings",
		},
	};

	it.each([false, true])(
		"reads fresh state after review notification (completed=%s)",
		async (complete) => {
			const h = harness();
			await h.emit("session_start");
			await h.turn("stop", "task_update");
			await h.settle({ continue: true });
			await h.execute("task_verify_step", reviewEvidence);
			if (complete)
				await h.execute("task_complete", {
					task_id: "T1",
					summary: "Reviewed implementation",
					evidence_ids: ["E1"],
				});
			await h.settle();
			expect(h.messages).toHaveLength(0);
		},
	);

	it("waits for all live subagents without duplicate work, across input and branch replay", async () => {
		const h = harness();
		await h.emit("session_start");
		for (const id of ["review-1", "review-2"])
			h.pi.events.emit("subagent:async-started", {
				id,
				sessionId: "session-1",
			});
		await h.emit("input");
		await h.emit("session_tree");
		await h.turn("stop", "task_update");
		await h.settle();
		expect(h.messages).toHaveLength(0);
		h.pi.events.emit("subagent:async-complete", {
			runId: "review-1",
			sessionId: "session-1",
		});
		await h.settle();
		expect(h.messages).toHaveLength(0);
		h.pi.events.emit("subagent:async-complete", {
			runId: "review-2",
			sessionId: "foreign-session",
		});
		await h.settle();
		expect(h.messages).toHaveLength(0);
		h.pi.events.emit("subagent:async-complete", {
			runId: "review-2",
			sessionId: "session-1",
		});
		await h.settle({ continue: true });
		expect(h.messages).toHaveLength(0);
		await h.settle();
		expect(h.messages).toHaveLength(1);
	});

	it("ignores foreign or malformed async events and cleans up subscriptions", async () => {
		const h = harness();
		await h.emit("session_start");
		for (const data of [
			null,
			{},
			{ id: 42, sessionId: "session-1" },
			{ id: "foreign", sessionId: "other" },
		])
			h.pi.events.emit("subagent:async-started", data);
		await h.turn("stop", "task_update");
		await h.settle();
		expect(h.messages).toHaveLength(1);
		await h.emit("session_start");
		expect(h.observers.get("subagent:async-started")?.size).toBe(1);
		await h.emit("session_shutdown");
		expect(h.observers.get("subagent:async-started")?.size).toBe(0);
		expect(h.observers.get("subagent:async-complete")?.size).toBe(0);
	});
});
