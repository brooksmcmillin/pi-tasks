import type { TaskState } from "./model.ts";
import type { ExtensionAPI } from "./pi-types.ts";
export declare const TASK_STATE_EVENT = "pi-tasks:state";
export declare const TASK_WIDGET_ID = "pi-tasks";
export type TaskStateEventReason = "session_start" | "session_tree" | "task_mutation";
export interface TaskStateEvent {
    version: 1;
    reason: TaskStateEventReason;
    widgetId: typeof TASK_WIDGET_ID;
    state: Omit<TaskState, "events">;
}
export declare function emitTaskState(pi: ExtensionAPI, state: TaskState, reason: TaskStateEventReason): void;
