export const TASK_EVENT_CUSTOM_TYPE = "pi-tasks:event";
export const TASK_SNAPSHOT_CUSTOM_TYPE = "pi-tasks:snapshot";
export const MAX_DECOMPOSITION_DEPTH = 4;
export const MAX_EVIDENCE_SUMMARY_LENGTH = 500;
export const MAX_EVIDENCE_OBSERVED_OUTPUT_LENGTH = 1000;
export const MAX_EVIDENCE_REFERENCE_LENGTH = 300;
export function isAtMaximumDecompositionDepth(step) {
    return (step.decompositionStatus !== "atomic" &&
        step.depth >= MAX_DECOMPOSITION_DEPTH);
}
export function createEmptyState() {
    return { tasks: {}, events: [], warnings: [] };
}
