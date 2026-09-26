import { createEmptyState, TASK_EVENT_CUSTOM_TYPE, } from "./model.js";
import { reduceTaskState, TaskTransitionError } from "./reducer.js";
import { classifyMechanicStep, mechanicStepMessage, } from "./support-actions.js";
export function createTaskRuntimeStore(initialState = createEmptyState()) {
    let state = initialState;
    return {
        getState() {
            return state;
        },
        replay(branchEntries) {
            const replayed = replayBranchEntries(branchEntries);
            state = replayed.state;
            return replayed;
        },
        append(event, appendEntry) {
            // Tightened authoring rules must not invalidate previously persisted plans.
            const steps = event.type === "task.created"
                ? (event.planSteps ?? event.initialSteps?.map((text) => ({ text })))
                : event.type === "task.steps_decomposed"
                    ? event.childSteps
                    : event.type === "task.reworked" || event.type === "task.replanned"
                        ? event.planSteps
                        : undefined;
            for (const step of steps ?? []) {
                const kind = classifyMechanicStep(step.text, true);
                if (kind)
                    throw new TaskTransitionError(mechanicStepMessage(kind, step.text));
            }
            const next = reduceTaskState(state, event);
            appendEntry(TASK_EVENT_CUSTOM_TYPE, event);
            state = next;
            return state;
        },
    };
}
export function replayBranchEntries(entries) {
    let state = createEmptyState();
    const malformedEvents = [];
    for (const entry of entries) {
        if (entry.type !== "custom" || entry.customType !== TASK_EVENT_CUSTOM_TYPE)
            continue;
        if (!isTaskEvent(entry.data)) {
            malformedEvents.push(`Entry ${entry.id ?? "unknown"} is not a pi-tasks event`);
            continue;
        }
        try {
            state = reduceTaskState(state, entry.data);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            malformedEvents.push(`Entry ${entry.id ?? entry.data.id}: ${message}`);
        }
    }
    if (malformedEvents.length > 0) {
        state.warnings.push(...malformedEvents);
    }
    return { state, malformedEvents };
}
export function snapshotState(state) {
    const { events: _events, ...snapshot } = state;
    return snapshot;
}
function isTaskEvent(value) {
    if (!value || typeof value !== "object")
        return false;
    const maybe = value;
    return (maybe.version === 1 &&
        typeof maybe.id === "string" &&
        typeof maybe.type === "string");
}
export function errorText(error) {
    if (error instanceof TaskTransitionError)
        return error.message;
    if (error instanceof Error)
        return error.message;
    return String(error);
}
