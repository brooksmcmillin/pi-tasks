import { describe, expect, it, vi } from "vitest";
import taskExtension from "../../index.ts";
import {
	type OrchestrationHandoff,
	validateHandoff,
} from "../../src/handoff.ts";
import {
	TASK_EVENT_CUSTOM_TYPE,
	type TaskResumeContext,
} from "../../src/model.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "../../src/pi-types.ts";
import { type BranchEntry, replayBranchEntries } from "../../src/store.ts";

const lane: OrchestrationHandoff = {
	taskId: "workaide-task",
	cwd: "/worktrees/task",
	branch: "feature",
	base: "base-sha",
	head: "candidate-sha",
	worker: {
		runId: "existing-run",
		sessionId: "child-session",
		missionId: "existing-mission",
	},
	ownershipBoundary:
		"Existing child owns edits; parent must not write concurrently",
	publicationBoundary: "Parent only, authorized feature remote; no merge",
	lastVerifiedGate: {
		name: "focused tests",
		head: "candidate-sha",
		reference: "/artifacts/tests",
	},
	nextAction: "Review existing child's output after it finishes",
	pendingDecision: "User must choose rollout strategy",
	pr: {
		url: "https://github.com/owner/repo/pull/1",
		head: "published-sha",
		reference: "/artifacts/ci",
	},
};

function harness(entries: BranchEntry[] = []) {
	const handlers = new Map<
		string,
		(event: unknown, ctx: ExtensionContext) => unknown
	>();
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const commands = new Map<string, unknown>();
	const sendMessage = vi.fn();
	const pi: ExtensionAPI = {
		on: (name, handler) => {
			handlers.set(
				name,
				handler as (event: unknown, ctx: ExtensionContext) => unknown,
			);
		},
		events: { emit: () => {} },
		registerTool: (tool) => {
			tools.set(tool.name, tool);
		},
		registerCommand: (name, command) => {
			commands.set(name, command);
		},
		appendEntry: (customType, data) => {
			entries.push({ type: "custom", customType, data: structuredClone(data) });
		},
		sendMessage,
	};
	const ctx: ExtensionContext = {
		sessionManager: {
			getBranch: () => entries,
			getSessionId: () => "parent-session",
		},
		ui: { notify: () => {}, setWidget: () => {}, setStatus: () => {} },
	};
	taskExtension(pi);
	return {
		entries,
		tools,
		sendMessage,
		emit: (name: string) => handlers.get(name)?.({}, ctx),
		execute: (name: string, params: Record<string, unknown> = {}) => {
			const tool = tools.get(name);
			if (!tool) throw new Error(`Missing tool ${name}`);
			return tool.execute("call", params, undefined, undefined, ctx);
		},
	};
}

async function planned() {
	const h = harness();
	await h.execute("task_plan", {
		title: "Implement handoff",
		objective: "Preserve recovery context",
		acceptance_criteria: ["Recovery verified"],
		plan_steps: [
			{
				text: "Implement handoff recovery",
				expectedOutput: "Verified recovery feature",
				allowedActions: ["edit", "test"],
			},
		],
	});
	return h;
}

describe("checkpoint orchestration handoff", () => {
	it("recovers the exact existing child and next action from a compaction snapshot alone without launching work", async () => {
		const h = await planned();
		await h.execute("task_checkpoint", { handoff: [lane] });
		await h.emit("session_before_compact");
		const snapshot = h.entries.at(-1);
		if (!snapshot) throw new Error("Missing compaction snapshot");
		expect(snapshot.customType).toBe(TASK_EVENT_CUSTOM_TYPE);
		const resumed = harness([structuredClone(snapshot)]);
		await resumed.emit("session_start");
		const result = await resumed.execute("task_resume");
		const contract = result.details as TaskResumeContext;
		expect(contract.currentStepId).toBe("T1-S1");
		expect(contract.handoff?.lanes).toEqual([lane]);
		expect(contract.handoff?.authority).toBe("none");
		expect(contract.handoff?.revalidationRequired).toBe(true);
		expect(contract.handoff?.nextAction).toContain("inspect existing runs");
		expect(result.content[0]).toMatchObject({
			text: expect.stringContaining("existing-run"),
		});
		expect(resumed.entries).toHaveLength(1);
		expect(resumed.sendMessage).not.toHaveBeenCalled();
		expect(resumed.tools.has("subagent")).toBe(false);
	});

	it("retains stale heads as history, never treating recorded ownership or successful receipts as fresh authority", async () => {
		const h = await planned();
		await h.execute("task_checkpoint", {
			handoff: [
				{
					...lane,
					publicationBoundary: "Previously approved",
					lastVerifiedGate: {
						name: "CI succeeded",
						head: "old-head",
						reference: "/artifacts/old-ci",
					},
				},
			],
		});
		for (const event of ["session_start", "session_tree"]) {
			await h.emit(event);
			const result = await h.execute("task_resume");
			const recovery = (result.details as TaskResumeContext).handoff;
			if (!recovery) throw new Error("Missing handoff");
			expect(recovery.authority).toBe("none");
			expect(recovery.revalidationRequired).toBe(true);
			expect(recovery.instruction).toContain(
				"current candidate/published head",
			);
			expect(recovery.instruction).toContain(
				"missing or unknown status never means terminal",
			);
			expect(recovery.instruction).toContain(
				"Pending decisions still require resolution",
			);
			expect(recovery.instruction).toContain(
				"does not provide unattended process restart",
			);
		}
	});

	it("preserves omitted lanes, replaces explicitly, clears with [], and isolates branch history", async () => {
		const h = await planned();
		const beforeHandoff = structuredClone(h.entries);
		await h.execute("task_checkpoint", { handoff: [lane] });
		await h.execute("task_checkpoint", { reason: "retain" });
		expect((await h.execute("task_resume")).details).toMatchObject({
			handoff: { lanes: [lane] },
		});
		await h.execute("task_checkpoint", {
			handoff: [
				{
					...lane,
					head: "new-head",
					worker: undefined,
					pendingDecision: undefined,
				},
			],
		});
		expect((await h.execute("task_resume")).details).toMatchObject({
			handoff: { lanes: [{ head: "new-head" }] },
		});
		await h.execute("task_checkpoint", { handoff: [] });
		expect((await h.execute("task_resume")).details).not.toHaveProperty(
			"handoff",
		);
		const otherBranch = harness(beforeHandoff);
		await otherBranch.emit("session_tree");
		expect(
			(await otherBranch.execute("task_resume")).details,
		).not.toHaveProperty("handoff");
	});

	it("does not attach a prior task's handoff to a new active task", async () => {
		const h = await planned();
		await h.execute("task_checkpoint", { handoff: [lane] });
		await h.execute("task_plan", {
			title: "Another objective",
			objective: "Separate task context",
			acceptance_criteria: ["Output verified"],
			plan_steps: [
				{
					text: "Implement separate output",
					expectedOutput: "Separate feature",
					allowedActions: ["edit"],
				},
			],
		});
		expect((await h.execute("task_resume")).details).not.toHaveProperty(
			"handoff",
		);
		expect(replayBranchEntries(h.entries).state.tasks.T1.handoff).toEqual([
			lane,
		]);
	});

	it("requires an active task and rejects malformed/oversized handoffs before persistence", async () => {
		await expect(
			harness().execute("task_checkpoint", { handoff: [lane] }),
		).rejects.toThrow("active task");
		const h = await planned();
		const length = h.entries.length;
		for (const handoff of [
			[{ ...lane, head: " " }],
			[{ ...lane, authority: "granted" }],
			Array(9).fill(lane),
			[{ ...lane, worker: { runId: "missing-session" } }],
		]) {
			await expect(h.execute("task_checkpoint", { handoff })).rejects.toThrow();
			expect(h.entries).toHaveLength(length);
		}
		expect(() =>
			validateHandoff(
				Array(8).fill({
					...lane,
					nextAction: "x".repeat(1024),
					ownershipBoundary: "x".repeat(1024),
				}),
			),
		).toThrow("16 KiB");
		await h.execute("task_checkpoint", { handoff: [lane] });
		const corrupted = JSON.parse(
			JSON.stringify(h.entries.at(-1)),
		) as BranchEntry;
		const data = corrupted.data as {
			state: { tasks: { T1: { handoff: unknown } } };
		};
		data.state.tasks.T1.handoff = [{ ...lane, authority: "granted" }];
		expect(replayBranchEntries([corrupted]).malformedEvents).toHaveLength(1);
	});
});
