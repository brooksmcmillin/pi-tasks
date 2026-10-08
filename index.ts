import { registerTaskCommands } from "./src/commands.ts";
import { createContinuationAdvisory } from "./src/continuation.ts";
import type { TaskEvent } from "./src/model.ts";
import type { ExtensionAPI, ExtensionContext } from "./src/pi-types.ts";
import {
	PICKUP_OWNERSHIP_EVENT,
	pickupOwnsRecovery,
} from "./src/pickup-ownership.ts";
import { buildTaskResume } from "./src/render.ts";
import {
	TASK_STATE_EVENT,
	TASK_TELEMETRY_EVENT,
	TASK_WIDGET_ID,
	type TaskContextContract,
	type TaskStateEvent,
	type TaskStateEventReason,
	type TaskTelemetryEvent,
} from "./src/state-events.ts";
import { createTaskRuntimeStore, snapshotState } from "./src/store.ts";
import { reconcileTaskTools, registerTaskTools } from "./src/tools.ts";
import { updateTaskUi } from "./src/widget.ts";

export {
	TASK_STATE_EVENT,
	TASK_TELEMETRY_EVENT,
	TASK_WIDGET_ID,
	type TaskContextContract,
	type TaskStateEvent,
	type TaskStateEventReason,
	type TaskTelemetryEvent,
};

export default function (pi: ExtensionAPI) {
	const store = createTaskRuntimeStore();
	const continuation = createContinuationAdvisory();
	let pickupOwnsContinuation = false;
	// Subscribe before lifecycle replay, in either extension load order. Only the
	// owner's publications reset this state; our input/replay handlers must not.
	const unsubscribePickup = pi.events.on?.(PICKUP_OWNERSHIP_EVENT, (data) => {
		const owns = pickupOwnsRecovery(data);
		if (owns !== undefined) pickupOwnsContinuation = owns;
		if (owns) continuation.relinquish();
	});
	const asyncRuns = new Set<string>();
	let unsubscribeAsync: Array<() => void> = [];
	const clearAsync = () => {
		for (const unsubscribe of unsubscribeAsync) unsubscribe();
		unsubscribeAsync = [];
		asyncRuns.clear();
	};
	const watchAsync = (ctx: ExtensionContext) => {
		clearAsync();
		const sessionId = ctx.sessionManager.getSessionId?.();
		if (!sessionId || !pi.events.on) return;
		for (const [event, started] of [
			["subagent:async-started", true],
			["subagent:async-complete", false],
		] as const) {
			unsubscribeAsync.push(
				pi.events.on(event, (data) => {
					if (
						!data ||
						typeof data !== "object" ||
						!("sessionId" in data) ||
						data.sessionId !== sessionId
					)
						return;
					const id = started
						? "id" in data
							? data.id
							: undefined
						: "runId" in data
							? data.runId
							: undefined;
					if (typeof id !== "string" || !id) return;
					if (started) asyncRuns.add(id);
					else asyncRuns.delete(id);
				}),
			);
		}
	};

	const replay = (
		ctx: ExtensionContext,
		reason: Extract<TaskStateEventReason, "session_start" | "session_tree">,
	) => {
		continuation.reset();
		const result = store.replay(ctx.sessionManager.getBranch());
		reconcileTaskTools(pi, result.state);
		updateTaskUi(pi, ctx, result.state, reason);
		if (result.malformedEvents.length > 0) {
			ctx.ui.notify(
				`pi-tasks skipped ${result.malformedEvents.length} malformed event(s)`,
				"warning",
			);
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		watchAsync(ctx);
		replay(ctx, "session_start");
	});
	pi.on("session_tree", async (_event, ctx) => replay(ctx, "session_tree"));
	pi.on("input", () => continuation.reset());
	pi.on("session_shutdown", () => {
		continuation.reset();
		clearAsync();
		unsubscribePickup?.();
		pickupOwnsContinuation = false;
	});
	pi.on("tool_result", (event) => {
		if (pickupOwnsContinuation) continuation.relinquish();
		continuation.observeToolResult(
			event.toolName,
			event.isError,
			event.input,
			event.details,
		);
	});
	pi.on("agent_before_settle", (event, ctx) => {
		if (
			event.outcome !== "completed" ||
			event.continue ||
			event.context.pendingMessages.length > 0 ||
			ctx.signal?.aborted ||
			ctx.hasPendingMessages?.() ||
			asyncRuns.size > 0 ||
			pickupOwnsContinuation
		)
			return;
		const content = continuation.take(store.getState());
		if (!content) return;
		return {
			entries: [
				...(event.entries ?? []),
				{
					type: "custom_message",
					customType: "pi-tasks:yield-check",
					content,
					display: true,
				},
			],
			continue: true,
		};
	});
	pi.on("session_before_compact", async (_event, ctx) => {
		const state = store.getState();
		if (Object.keys(state.tasks).length > 0) {
			const createdAt = new Date().toISOString();
			const event: TaskEvent = {
				version: 1,
				id: `snapshot-${createdAt}`,
				type: "task.snapshot",
				taskId: state.activeTaskId ?? "snapshot",
				createdAt,
				source: "system",
				state: snapshotState(state),
				resume: buildTaskResume(state),
				reason: "compaction",
			};
			const next = store.append(event, (customType, data) => {
				pi.appendEntry(customType, data);
			});
			updateTaskUi(pi, ctx, next, "task_mutation");
		}
	});

	registerTaskTools(pi, store);
	registerTaskCommands(pi, store);
}
