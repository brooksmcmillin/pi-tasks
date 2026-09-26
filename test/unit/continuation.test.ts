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
	TurnEndEvent,
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
	const messages: Array<{ content: string; options: unknown }> = [];
	const pi: ExtensionAPI = {
		events: { emit: () => {} },
		on: (name, handler) => {
			handlers.set(
				name,
				handler as (event: unknown, ctx: ExtensionContext) => unknown,
			);
		},
		registerTool: () => {},
		registerCommand: () => {},
		appendEntry: () => {},
		sendMessage: (message, options) => {
			messages.push({ content: message.content, options });
		},
	};
	const ctx: ExtensionContext = {
		sessionManager: { getBranch: () => branch },
		hasPendingMessages: () => false,
		ui: { notify: () => {}, setWidget: () => {}, setStatus: () => {} },
	};
	taskExtension(pi);
	const emit = async (name: string, event: unknown = {}) => {
		await handlers.get(name)?.(event, ctx);
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
		} satisfies TurnEndEvent);
	};
	return { pi, ctx, messages, emit, turn };
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
		await h.turn();
		expect(h.messages).toHaveLength(0);
	});

	it("sends one follow-up only at a normal final response after task work", async () => {
		const h = harness();
		await h.emit("session_start");
		await h.turn("toolUse", "task_update");
		expect(h.messages).toHaveLength(0);
		await h.turn();
		expect(h.messages).toHaveLength(1);
		expect(h.messages[0].options).toEqual({ deliverAs: "followUp" });
		await h.turn("toolUse", "task_update");
		await h.turn();
		expect(h.messages).toHaveLength(1);
	});

	it.each(["input", "session_tree", "session_start", "session_shutdown"])(
		"%s disarms previous task work",
		async (name) => {
			const h = harness();
			await h.emit("session_start");
			await h.turn("toolUse", "task_update");
			await h.emit(name);
			await h.turn();
			expect(h.messages).toHaveLength(0);
		},
	);

	it("leaves explanation-only task queries alone despite a replayed active task", async () => {
		const h = harness();
		await h.emit("session_start");
		await h.turn("toolUse", "task_resume");
		await h.turn();
		expect(h.messages).toHaveLength(0);
	});

	it.each(["aborted", "error", "length", "toolUse"])(
		"does not restart a %s ending",
		async (reason) => {
			const h = harness();
			await h.emit("session_start");
			await h.turn("toolUse", "task_update");
			await h.turn(reason);
			expect(h.messages).toHaveLength(0);
		},
	);

	it("respects cancellation and queued work", async () => {
		const h = harness();
		await h.emit("session_start");
		await h.turn("toolUse", "task_update");
		h.ctx.signal = AbortSignal.abort();
		await h.turn();
		expect(h.messages).toHaveLength(0);
		h.ctx.signal = undefined;
		h.ctx.hasPendingMessages = () => true;
		await h.turn();
		expect(h.messages).toHaveLength(0);
	});

	it("does not require optional continuation APIs from compatible hosts", async () => {
		const h = harness();
		await h.emit("session_start");
		await h.turn("toolUse", "task_update");
		h.pi.sendMessage = undefined;
		h.ctx.hasPendingMessages = undefined;
		await h.turn();
		expect(h.messages).toHaveLength(0);
	});
});
