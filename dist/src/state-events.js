import { buildTaskResume } from "./render.js";
export const TASK_STATE_EVENT = "pi-tasks:state";
export const TASK_TELEMETRY_EVENT = "pi-tasks:telemetry";
export const TASK_WIDGET_ID = "pi-tasks";
export function emitTaskState(pi, state, reason) {
    const task = state.activeTaskId ? state.tasks[state.activeTaskId] : undefined;
    const resume = buildTaskResume(state);
    const step = task?.planSteps.find((item) => item.status !== "done" && item.status !== "skipped");
    const event = {
        version: 2,
        reason,
        widgetId: TASK_WIDGET_ID,
        context: {
            version: 1,
            ...(state.lastUpdatedAt ? { stateVersion: state.lastUpdatedAt } : {}),
            ...(task
                ? {
                    activeTask: {
                        id: task.id,
                        title: task.title,
                        status: task.status,
                        progress: task.progress,
                        ...(step
                            ? {
                                currentStep: {
                                    id: step.id,
                                    text: step.text,
                                    decompositionStatus: step.decompositionStatus,
                                    evidenceRequired: step.evidenceRequired,
                                    allowedActions: [...step.allowedActions],
                                },
                            }
                            : {}),
                        blockers: task.blockers.filter((blocker) => !blocker.resolvedAt),
                        evidenceGaps: resume.verificationGaps,
                    },
                }
                : {}),
        },
    };
    try {
        pi.events.emit(TASK_STATE_EVENT, event);
    }
    catch {
        // UI observers must not break an already-persisted task transition.
    }
    try {
        pi.events.emit(TASK_TELEMETRY_EVENT, {
            version: 1,
            event: "task_context.compact_published",
            reason,
            ...(event.context.stateVersion
                ? { stateVersion: event.context.stateVersion }
                : {}),
            payloadBytes: JSON.stringify(event.context).length,
        });
    }
    catch {
        // Telemetry observers must not break an already-persisted task transition.
    }
}
