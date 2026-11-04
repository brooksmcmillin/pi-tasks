import type { TaskStepInput } from "./model.ts";
export interface CompactRemediation {
    finding: string;
    deliverable: string;
    boundedScope: string;
    verification: string;
    atomic?: boolean;
    criterionIds?: string[];
}
export declare const COMPACT_REMEDIATION_GUIDANCE = "Supply either remediation { finding, deliverable, boundedScope, verification, atomic?, criterionIds? } or the existing reason + plan_steps, never both. Compact input derives an evidence-required deliverable step and two bounded actions. Optional atomic is a caller attestation only. The native model assesses every normalized step; caller flags cannot override its atomicity decision or substitute for evidence. before_step_id must name an open step; invalid targets never silently append.";
export declare function compactRemediationSchema(): import("./schema.ts").Schema;
export declare function normalizeReworkInput(params: {
    reason?: string;
    plan_steps?: TaskStepInput[];
    remediation?: CompactRemediation;
}): {
    reason: string;
    planSteps: TaskStepInput[];
};
