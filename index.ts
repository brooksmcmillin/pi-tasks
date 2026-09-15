import { registerTaskCommands } from "./src/commands.ts";
import { createContinuationAdvisory } from "./src/continuation.ts";
import type { TaskEvent } from "./src/model.ts";
import type { ExtensionAPI, ExtensionContext } from "./src/pi-types.ts";
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

	pi.on("session_start", async (_event, ctx) => replay(ctx, "session_start"));
	pi.on("session_tree", async (_event, ctx) => replay(ctx, "session_tree"));
	pi.on("input", () => continuation.reset());
	pi.on("session_shutdown", () => continuation.reset());
	pi.on("tool_result", (event) => {
		continuation.observeToolResult(
			event.toolName,
			event.isError,
			event.input,
			event.details,
		);
	});
	pi.on("turn_end", (event, ctx) => {
		if (
			event.message.role !== "assistant" ||
			event.message.stopReason !== "stop" ||
			ctx.signal?.aborted ||
			!ctx.hasPendingMessages ||
			ctx.hasPendingMessages() ||
			!pi.sendMessage
		)
			return;
		const content = continuation.take(store.getState());
		if (content) {
			pi.sendMessage(
				{ customType: "pi-tasks:yield-check", content, display: true },
				{ deliverAs: "followUp" },
			);
		}
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
