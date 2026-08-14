import type { TaskBlocker, TaskState, TaskStatus, TaskStep } from "./model.ts";
import type { ExtensionAPI } from "./pi-types.ts";
export declare const TASK_STATE_EVENT = "pi-tasks:state";
export declare const TASK_TELEMETRY_EVENT = "pi-tasks:telemetry";
export declare const TASK_WIDGET_ID = "pi-tasks";
export type TaskStateEventReason = "session_start" | "session_tree" | "task_mutation";
export interface TaskContextContract {
    version: 1;
    stateVersion?: string;
    activeTask?: {
        id: string;
        title: string;
        status: TaskStatus;
        progress: number;
        currentStep?: Pick<TaskStep, "id" | "text" | "decompositionStatus" | "evidenceRequired" | "allowedActions">;
        blockers: TaskBlocker[];
        evidenceGaps: string[];
    };
}
export interface TaskStateEvent {
    version: 2;
    reason: TaskStateEventReason;
    widgetId: typeof TASK_WIDGET_ID;
    context: TaskContextContract;
}
export interface TaskTelemetryEvent {
    version: 1;
    event: "task_context.compact_published" | "task_context.full_state_recovery_served";
    reason: TaskStateEventReason | "explicit_request";
    stateVersion?: string;
    payloadBytes: number;
}
export declare function emitTaskState(pi: ExtensionAPI, state: TaskState, reason: TaskStateEventReason): void;
