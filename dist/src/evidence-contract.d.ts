import type { AcceptanceCriterion, Task, TaskEvidence, TaskStep } from "./model.ts";
export interface EvidenceContract {
    version: 1;
    objective: string;
    role: "acceptance" | "diagnostic";
    steps: {
        id: string;
        text: string;
        expectedOutput: string;
    }[];
    criteria: {
        id: string;
        text: string;
    }[];
}
/** Resolve only persisted meanings; evidence prose cannot redefine its targets. */
export declare function evidenceContract(task: Task, links: {
    stepIds?: string[] | undefined;
    criterionIds?: string[] | undefined;
    role?: "acceptance" | "diagnostic" | undefined;
}): EvidenceContract;
/** Existing IDs are not permission to reuse proof for a different outcome. */
export declare function evidenceSupportsTarget(task: Task, evidence: TaskEvidence, target: TaskStep | AcceptanceCriterion): boolean;
