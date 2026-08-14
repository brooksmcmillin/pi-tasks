import type { TaskBlocker, TaskState, TaskStatus, TaskStep } from "./model.ts";
import type { ExtensionAPI } from "./pi-types.ts";
import { buildTaskResume } from "./render.ts";

export const TASK_STATE_EVENT = "pi-tasks:state";
export const TASK_TELEMETRY_EVENT = "pi-tasks:telemetry";
export const TASK_WIDGET_ID = "pi-tasks";

export type TaskStateEventReason =
	| "session_start"
	| "session_tree"
	| "task_mutation";

export interface TaskContextContract {
	version: 1;
	stateVersion?: string;
	activeTask?: {
		id: string;
		title: string;
		status: TaskStatus;
		progress: number;
		currentStep?: Pick<
			TaskStep,
			| "id"
			| "text"
			| "decompositionStatus"
			| "evidenceRequired"
			| "allowedActions"
		>;
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
	event:
		| "task_context.compact_published"
		| "task_context.full_state_recovery_served";
	reason: TaskStateEventReason | "explicit_request";
	stateVersion?: string;
	payloadBytes: number;
}

export function emitTaskState(
	pi: ExtensionAPI,
	state: TaskState,
	reason: TaskStateEventReason,
): void {
	const task = state.activeTaskId ? state.tasks[state.activeTaskId] : undefined;
	const resume = buildTaskResume(state);
	const step = task?.planSteps.find(
		(item) => item.status !== "done" && item.status !== "skipped",
	);
	const event: TaskStateEvent = {
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
	} catch {
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
		} satisfies TaskTelemetryEvent);
	} catch {
		// Telemetry observers must not break an already-persisted task transition.
	}
}
