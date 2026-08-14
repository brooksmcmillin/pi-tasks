import { snapshotState } from "./store.js";
export const TASK_STATE_EVENT = "pi-tasks:state";
export const TASK_WIDGET_ID = "pi-tasks";
export function emitTaskState(pi, state, reason) {
    const event = {
        version: 1,
        reason,
        widgetId: TASK_WIDGET_ID,
        state: structuredClone(snapshotState(state)),
    };
    try {
        pi.events.emit(TASK_STATE_EVENT, event);
    }
    catch {
        // UI observers must not break an already-persisted task transition.
    }
}
