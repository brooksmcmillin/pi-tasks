export declare const PILOT_VERSION = "phase-checkpoint-v1";
export declare const COHORT_ENTRY = "pi-tasks:compaction-cohort";
export type Cohort = "baseline" | "pilot";
export interface Assignment {
    version: 1;
    policy: typeof PILOT_VERSION;
    rootSessionId: string;
    rootTaskId: string;
    cohort: Cohort;
}
export declare function isAssignment(value: unknown): value is Assignment;
export declare function assignCohort(prior: unknown[], rootTaskId: string, sessionId: string, optIn: string | undefined): Assignment | undefined;
export declare function thresholds(window: number): {
    eligible: number;
    target: number;
    fallback: number;
    keepRecentTokens: number;
} | undefined;
export declare function compactionDecision(input: {
    cohort: Cohort;
    tokens: number | null;
    window: number;
    phaseBoundary: boolean;
    betweenTurns: boolean;
    checkpointKnown: boolean;
}): {
    trigger: boolean;
    reason: string;
};
