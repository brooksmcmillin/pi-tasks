import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import taskExtension from "../../index.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
	SettlementEntry,
	ToolDefinition,
} from "../../src/pi-types.ts";
import {
	PICKUP_OWNERSHIP_EVENT,
	pickupOwnsRecovery,
} from "../../src/pickup-ownership.ts";
import { historicalFinals } from "../fixtures/infra-task-continuation/historical.ts";
import pickupExtension from "../fixtures/infra-task-continuation/state.ts";

it("keeps the pinned producer fixtures unchanged", () => {
	for (const [file, digest] of Object.entries({
		"state.ts":
			"be2ab668b34b45f2c6e0a1b1c1f6506b63497d51afdaa2264b16594ff135758b",
		"index.ts":
			"dbfccb7921d4f881ee9621aa54566fb0f54fd5e5e767b8559b6e1ac6ea2b3630",
	})) {
		const source = readFileSync(
			new URL(`../fixtures/infra-task-continuation/${file}`, import.meta.url),
		);
		expect(createHash("sha256").update(source).digest("hex")).toBe(digest);
	}
});

type Entry = { type: string; customType?: string; data?: unknown };
type Boundary = {
	entries: SettlementEntry[];
	continue: boolean;
	outcome: string;
	context: { pendingMessages: unknown[] };
};
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
const plan = {
	title: "Implement bounded recovery",
	objective: "Coordinate the two advisories",
	acceptance_criteria: ["Only one recovery occurs"],
	plan_steps: [
		{
			text: "Implement recovery coordination",
			expectedOutput: "Verified recovery coordination",
			allowedActions: ["edit", "test"],
			decompositionStatus: "atomic",
			granularityCheck: {
				isAtomic: true,
				reason: "One bounded implementation and verification cycle",
				unit: "deliverable",
				boundedScope: "Only advisory ownership coordination and its tests",
				verificationPlan: "Run deterministic two-extension lifecycle tests",
				canBeDoneInOneAgentAction: true,
				hasSingleObservableOutput: true,
				hasSingleVerificationMethod: true,
				hasNoHiddenSubtasks: true,
			},
		},
	],
};

function harness(
	pickupFirst: boolean,
	initial: Entry[] = [],
	withPickup = true,
) {
	let branch = structuredClone(initial);
	const handlers = new Map<string, Handler[]>();
	const observers = new Map<string, Set<(data: unknown) => void>>();
	const tools = new Map<string, ToolDefinition<Record<string, unknown>>>();
	const pi: ExtensionAPI = {
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler as Handler);
			handlers.set(name, list);
		},
		events: {
			on(name, handler) {
				const list = observers.get(name) ?? new Set();
				list.add(handler);
				observers.set(name, list);
				return () => {
					list.delete(handler);
				};
			},
			emit(name, data) {
				for (const handler of observers.get(name) ?? []) handler(data);
			},
		},
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
		appendEntry(customType, data) {
			branch.push({ type: "custom", customType, data: structuredClone(data) });
		},
		sendMessage() {
			throw new Error("Must not queue a follow-up");
		},
	};
	const ctx: ExtensionContext = {
		sessionManager: { getBranch: () => branch, getSessionId: () => "session" },
		hasPendingMessages: () => false,
		ui: { notify() {}, setStatus() {}, setWidget() {} },
	};
	// The vendored producer uses the full SDK API; this harness implements only
	// the capabilities exercised by both real extension registrations.
	const pickup = () =>
		pickupExtension(
			pi as unknown as Parameters<typeof pickupExtension>[0],
			{} as Parameters<typeof pickupExtension>[1],
		);
	if (withPickup && pickupFirst) pickup();
	taskExtension(pi);
	if (withPickup && !pickupFirst) pickup();
	const emit = async (name: string, event: unknown = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	const execute = async (name: string, input: Record<string, unknown>) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`Missing ${name}`);
		const result = await tool.execute("call", input, undefined, undefined, ctx);
		expect(result.isError).not.toBe(true);
		await emit("tool_result", {
			toolName: name,
			input,
			isError: false,
			details: result.details,
		});
		return result;
	};
	return {
		pi,
		ctx,
		emit,
		execute,
		observers,
		branch: () => structuredClone(branch),
		async switchBranch(entries: Entry[]) {
			branch = structuredClone(entries);
			await emit("session_tree");
		},
		pickup: (disposition = "proceed", extra = {}) =>
			execute("task_pickup", {
				task_id: "5168",
				disposition,
				next_action:
					"Finish targeted MCP readiness discovery, then preflight before claiming.",
				...extra,
			}),
		async settle(overrides: Partial<Boundary> = {}) {
			let event: Boundary = {
				entries: [],
				continue: false,
				outcome: "completed",
				context: { pendingMessages: [] },
				...overrides,
			};
			for (const handler of handlers.get("agent_before_settle") ?? []) {
				const result = (await handler(event, ctx)) as
					| Partial<Boundary>
					| undefined;
				if (result)
					event = {
						...event,
						...result,
						continue: event.continue || !!result.continue,
					};
			}
			branch.push(...structuredClone(event.entries));
			return event;
		},
	};
}

for (const pickupFirst of [true, false]) {
	describe(`pickup coordination: pickup registered ${pickupFirst ? "first" : "last"}`, () => {
		it("replays historical pre-claim stops then hands off to a plan without a second recovery", async () => {
			const h = harness(pickupFirst);
			await h.emit("session_start");
			await h.emit("input", { source: "interactive" });
			await h.pickup();
			await h.emit("turn_end", {
				message: { role: "assistant", content: historicalFinals[0] },
			});
			const first = await h.settle();
			expect(first.continue).toBe(true);
			expect(first.entries.at(-1)?.customType).toBe("task-continuation:nudge");
			await h.execute("task_plan", plan);
			await h.emit("turn_end", {
				message: { role: "assistant", content: historicalFinals[1] },
			});
			const second = await h.settle();
			expect(second.continue).toBe(false);
			expect(second.entries.at(-1)?.customType).toBe("task-continuation:stall");
			for (let i = 0; i < 3; i++) {
				await h.execute("task_resume", {});
				await h.pickup();
				expect((await h.settle()).entries).toEqual([]);
			}
			expect(JSON.stringify(first.entries)).toMatch(/not a blocker/);
			expect(JSON.stringify(second.entries)).toMatch(
				/no further automatic turn/,
			);
		});

		it("gives pickup precedence for an authorized active open step, preserving earlier entries", async () => {
			const h = harness(pickupFirst);
			await h.emit("session_start");
			await h.pickup();
			await h.execute("task_plan", plan);
			const prior: SettlementEntry = {
				type: "custom",
				customType: "other",
				data: "keep",
			};
			const result = await h.settle({ entries: [prior] });
			expect(result.continue).toBe(true);
			expect(result.entries[0]).toEqual(prior);
			expect(
				result.entries
					.filter((e) => e.type === "custom_message")
					.map((e) => e.customType),
			).toEqual(["task-continuation:nudge"]);
		});

		it.each(["blocker", "decision", "wait", "complete", "stop"])(
			"respects explicit %s before and after spending the budget",
			async (disposition) => {
				for (const spent of [false, true]) {
					const h = harness(pickupFirst);
					await h.emit("session_start");
					await h.pickup();
					await h.execute("task_plan", plan);
					if (spent) await h.settle();
					if (disposition === "blocker" || disposition === "decision") {
						await h.execute("task_update", {
							task_id: "T1",
							blocker: {
								reason: "An owner decision is required",
								blockedBy: "user",
								neededToUnblock: "Owner chooses behavior",
							},
						});
					}
					await h.pickup(disposition, {
						reason: "Await owner or asynchronous result",
						blocked_by: "external",
					});
					expect((await h.settle()).entries).toEqual([]);
				}
			},
		);

		it("completes a verified Pi task and explicitly clears pickup intent", async () => {
			const h = harness(pickupFirst);
			await h.emit("session_start");
			await h.pickup();
			await h.execute("task_plan", plan);
			await h.execute("task_verify_step", {
				task_id: "T1",
				step_id: "T1-S1",
				criterion_ids: ["T1-AC1"],
				type: "test",
				level: "unit_test",
				summary: "Coordination assertions pass",
				references: ["replay.test.ts"],
				quality: {
					source: "offline replay",
					reproducible: true,
					verifier: "tool",
					command: "run replay assertions",
					artifactRefs: ["replay.test.ts"],
					observedOutput: "All assertions passed",
				},
			});
			await h.execute("task_complete", {
				task_id: "T1",
				summary: "Coordination verified",
				evidence_ids: ["E1"],
			});
			await h.pickup("complete");
			expect((await h.settle()).entries).toEqual([]);
		});

		it.each(["interactive", "rpc"])(
			"respects %s stop/redirection and requires fresh execution",
			async (source) => {
				const h = harness(pickupFirst);
				await h.emit("session_start");
				await h.pickup();
				await h.execute("task_plan", plan);
				await h.settle();
				await h.emit("input", { source, text: "Stop; explain instead" });
				await h.execute("task_resume", {});
				expect((await h.settle()).entries).toEqual([]);
				await h.pickup();
				expect((await h.settle()).continue).toBe(true);
			},
		);

		it("preserves spent budget through extension input, reload, task switches and branch replay", async () => {
			const h = harness(pickupFirst);
			await h.emit("session_start");
			await h.pickup();
			await h.execute("task_plan", plan);
			const fork = h.branch();
			await h.settle();
			await h.emit("input", { source: "extension" });
			await h.emit("session_shutdown");
			expect([...h.observers.values()].every((list) => list.size === 0)).toBe(
				true,
			);
			const resumed = harness(pickupFirst, h.branch());
			await resumed.emit("session_start");
			await resumed.execute("task_update", {
				task_id: "T1",
				note: "Still implementing",
			});
			expect((await resumed.settle()).continue).toBe(false);
			await resumed.pickup("complete");
			await resumed.pickup("proceed", { task_id: "7369" });
			expect((await resumed.settle()).continue).toBe(false);
			await resumed.switchBranch(fork);
			expect((await resumed.settle()).continue).toBe(true);
			await resumed.switchBranch([]);
			await resumed.execute("task_plan", plan);
			expect((await resumed.settle()).entries.at(-1)?.customType).toBe(
				"pi-tasks:yield-check",
			);
		});

		it("suppresses both owners for async waits, queued continuations, aborts and provider errors", async () => {
			const h = harness(pickupFirst);
			await h.emit("session_start");
			await h.pickup();
			await h.execute("task_plan", plan);
			for (const override of [
				{ outcome: "error" },
				{ outcome: "aborted" },
				{ continue: true },
				{ context: { pendingMessages: ["stop"] } },
			]) {
				expect((await h.settle(override)).entries).toEqual([]);
			}
			const abort = new AbortController();
			abort.abort();
			h.ctx.signal = abort.signal;
			expect((await h.settle()).entries).toEqual([]);
			delete h.ctx.signal;
			h.ctx.hasPendingMessages = () => true;
			expect((await h.settle()).entries).toEqual([]);
			h.ctx.hasPendingMessages = () => false;
			h.pi.events.emit("subagent:async-started", {
				sessionId: "session",
				id: "review",
			});
			expect((await h.settle()).entries).toEqual([]);
			await h.emit("session_shutdown");
			const resumed = harness(pickupFirst, h.branch());
			await resumed.emit("session_start");
			expect((await resumed.settle()).entries).toEqual([]);
			resumed.pi.events.emit("subagent:async-complete", {
				sessionId: "other",
				runId: "review",
			});
			expect((await resumed.settle()).entries).toEqual([]);
			resumed.pi.events.emit("subagent:async-complete", {
				sessionId: "session",
				runId: "review",
			});
			expect((await resumed.settle()).continue).toBe(true);
		});
	});
}

it("retains standalone recovery without a producer and ignores incompatible publications", async () => {
	const h = harness(false, [], false);
	await h.emit("session_start");
	await h.execute("task_plan", plan);
	h.pi.events.emit(PICKUP_OWNERSHIP_EVENT, {
		version: 2,
		owner: "named-task-pickup",
		handled: true,
	});
	const prior: SettlementEntry = {
		type: "custom",
		customType: "other",
		data: "retain",
	};
	const result = await h.settle({ entries: [prior] });
	expect(result.entries[0]).toEqual(prior);
	expect(result.entries.at(-1)?.customType).toBe("pi-tasks:yield-check");
	expect((await h.settle()).entries).toEqual([]);
});

it("validates v1 ownership and retains exhausted ownership when intent clears", () => {
	const signal = {
		version: 1,
		owner: "named-task-pickup",
		handled: false,
		disposition: "stop",
		remaining: 1,
		pendingAsync: false,
	};
	expect(pickupOwnsRecovery(signal)).toBe(false);
	for (const change of [
		{ handled: true },
		{ remaining: 0 },
		{ pendingAsync: true },
	])
		expect(pickupOwnsRecovery({ ...signal, ...change })).toBe(true);
	for (const value of [
		null,
		{},
		{ ...signal, version: 2 },
		{ ...signal, remaining: -1 },
		{ ...signal, owner: "other" },
		{ ...signal, disposition: "unknown" },
		{ ...signal, disposition: { toString: () => "stop" } },
	])
		expect(pickupOwnsRecovery(value)).toBeUndefined();
});
