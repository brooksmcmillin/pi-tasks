import { type AcceptanceCriterion, type EvidenceQuality, type Task, type TaskEvent, type TaskEvidence, type TaskState, type TaskStepInput } from "./model.ts";
import { type PlanAssessmentInput } from "./semantic-assessment.ts";
export type TaskTransitionErrorCode = "scope_activity_required" | "scope_reason_required" | "status_transition";
export declare class TaskTransitionError extends Error {
    readonly code: TaskTransitionErrorCode | undefined;
    constructor(message: string, code?: TaskTransitionErrorCode);
}
export declare function reduceTaskState(state: TaskState, event: TaskEvent, options?: {
    replay?: boolean;
}): TaskState;
export declare function replayTaskEvents(events: TaskEvent[]): TaskState;
export declare function taskMutationAssessmentInput(task: Task, event: Extract<TaskEvent, {
    type: "task.steps_decomposed" | "task.replanned" | "task.reworked" | "task.updated";
}>): PlanAssessmentInput;
export declare function taskPlanAssessmentInput(task: Task, steps: TaskStepInput[]): PlanAssessmentInput;
export declare function hasFreshCriterionEvidence(task: Task, criterion: AcceptanceCriterion): boolean;
export declare function normalizeEvidenceQuality(quality: EvidenceQuality | undefined, evidence: Omit<TaskEvidence, "taskId" | "createdAt" | "quality">): EvidenceQuality;
export declare function evidenceQualityEqual(left: EvidenceQuality, right: EvidenceQuality): boolean;
