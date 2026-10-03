import { registerTaskCommands } from "./src/commands.js";
import { createContinuationAdvisory } from "./src/continuation.js";
import { buildTaskResume } from "./src/render.js";
import { TASK_STATE_EVENT, TASK_TELEMETRY_EVENT, TASK_WIDGET_ID, } from "./src/state-events.js";
import { createTaskRuntimeStore, snapshotState } from "./src/store.js";
import { reconcileTaskTools, registerTaskTools } from "./src/tools.js";
import { updateTaskUi } from "./src/widget.js";
export { TASK_STATE_EVENT, TASK_TELEMETRY_EVENT, TASK_WIDGET_ID, };
export default function (pi) {
    const store = createTaskRuntimeStore();
    const continuation = createContinuationAdvisory();
    const asyncRuns = new Set();
    let unsubscribeAsync = [];
    const clearAsync = () => {
        for (const unsubscribe of unsubscribeAsync)
            unsubscribe();
        unsubscribeAsync = [];
        asyncRuns.clear();
    };
    const watchAsync = (ctx) => {
        clearAsync();
        const sessionId = ctx.sessionManager.getSessionId?.();
        if (!sessionId || !pi.events.on)
            return;
        for (const [event, started] of [
            ["subagent:async-started", true],
            ["subagent:async-complete", false],
        ]) {
            unsubscribeAsync.push(pi.events.on(event, (data) => {
                if (!data ||
                    typeof data !== "object" ||
                    !("sessionId" in data) ||
                    data.sessionId !== sessionId)
                    return;
                const id = started
                    ? "id" in data
                        ? data.id
                        : undefined
                    : "runId" in data
                        ? data.runId
                        : undefined;
                if (typeof id !== "string" || !id)
                    return;
                if (started)
                    asyncRuns.add(id);
                else
                    asyncRuns.delete(id);
            }));
        }
    };
    const replay = (ctx, reason) => {
        continuation.reset();
        const result = store.replay(ctx.sessionManager.getBranch());
        reconcileTaskTools(pi, result.state);
        updateTaskUi(pi, ctx, result.state, reason);
        if (result.malformedEvents.length > 0) {
            ctx.ui.notify(`pi-tasks skipped ${result.malformedEvents.length} malformed event(s)`, "warning");
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
    });
    pi.on("tool_result", (event) => {
        continuation.observeToolResult(event.toolName, event.isError, event.input, event.details);
    });
    pi.on("agent_before_settle", (event, ctx) => {
        if (event.outcome !== "completed" ||
            event.continue ||
            event.context.pendingMessages.length > 0 ||
            ctx.signal?.aborted ||
            ctx.hasPendingMessages?.() ||
            asyncRuns.size > 0)
            return;
        const content = continuation.take(store.getState());
        if (!content)
            return;
        return {
            entries: [
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
            const event = {
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
