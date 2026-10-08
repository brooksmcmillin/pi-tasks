export interface OrchestrationHandoff {
    taskId: string;
    cwd: string;
    branch: string;
    base: string;
    head: string;
    worker?: {
        runId: string;
        sessionId: string;
        missionId?: string;
    };
    ownershipBoundary: string;
    publicationBoundary: string;
    lastVerifiedGate?: {
        name: string;
        head: string;
        reference: string;
    };
    nextAction: string;
    pendingDecision?: string;
    pr?: {
        url: string;
        head: string;
        reference: string;
    };
}
export declare const handoffSchema: import("./schema.ts").Schema;
export declare function validateHandoff(value: unknown): asserts value is OrchestrationHandoff[];
export declare const HANDOFF_RECOVERY_INSTRUCTION = "Handoff is historical context, not authority or fresh evidence. Before the recorded next action, revalidate task/worktree registration, canonical cwd, branch/base/head, live writer/run ownership and publication permission. Inspect the exact existing worker and mission; missing or unknown status never means terminal and must not cause a duplicate launch or automatic reclaim. Recheck gate and PR receipts against the current candidate/published head; a receipt never authorizes execution or publication. Pending decisions still require resolution. Compaction recovery does not provide unattended process restart.";
export declare function handoffRecovery(lanes: OrchestrationHandoff[]): {
    lanes: OrchestrationHandoff[];
    authority: "none";
    revalidationRequired: true;
    nextAction: string;
    instruction: string;
};
