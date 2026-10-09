import type { TaskStepInput } from "./model.ts";
export interface CompactRemediation {
    finding: string;
    deliverable: string;
    boundedScope: string;
    verification: string;
    atomic?: boolean;
    criterionIds?: string[];
}
export declare const COMPACT_REMEDIATION_GUIDANCE = "Supply either remediation { finding, deliverable, boundedScope, verification, atomic?, criterionIds? } or the existing reason + plan_steps, never both. Compact input derives an evidence-required deliverable step and two bounded actions. Omit atomic for compound/unchecked work requiring task_decompose. atomic=true is an explicit attestation of one bounded observable outcome, one cohesive implementation/verification cycle, and no hidden subtasks; it derives all granularity flags, not evidence. before_step_id must name an open step; invalid targets never silently append.";
export declare function compactRemediationSchema(): import("./schema.ts").Schema;
export declare function normalizeReworkInput(params: {
    reason?: string;
    plan_steps?: TaskStepInput[];
    remediation?: CompactRemediation;
}): {
    reason: string;
    planSteps: TaskStepInput[];
};
