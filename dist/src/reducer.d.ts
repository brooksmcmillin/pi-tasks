import { type AcceptanceCriterion, type EvidenceQuality, type Task, type TaskEvent, type TaskEvidence, type TaskState } from "./model.ts";
export declare class TaskTransitionError extends Error {
    constructor(message: string);
}
export declare function reduceTaskState(state: TaskState, event: TaskEvent): TaskState;
export declare function replayTaskEvents(events: TaskEvent[]): TaskState;
export declare function hasFreshCriterionEvidence(task: Task, criterion: AcceptanceCriterion): boolean;
export declare function normalizeEvidenceQuality(quality: EvidenceQuality | undefined, evidence: Omit<TaskEvidence, "taskId" | "createdAt" | "quality">): EvidenceQuality;
export declare function evidenceQualityEqual(left: EvidenceQuality, right: EvidenceQuality): boolean;
