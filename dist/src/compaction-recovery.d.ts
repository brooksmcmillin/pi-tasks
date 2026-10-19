import type { TaskState } from "./model.ts";
import type { BranchEntry } from "./store.ts";
export declare const RECOVERY_ENTRY = "pi-tasks:compaction-checkpoint";
export type Verdict = "pass" | "mismatch" | "unknown";
export interface RepositoryIdentity {
    cwd: string;
    branch: string;
    head: string;
    dirtyStateReference: string;
}
export declare const digest: (value: unknown) => string;
export declare function repositoryIdentity(cwd: string | undefined): RepositoryIdentity | undefined;
export interface RecoveryCheckpoint {
    version: 1;
    id: string;
    taskId: string;
    stepId: string;
    revision: string;
    repository: RepositoryIdentity;
    prHeads: Array<{
        url: string;
        head: string;
        reference: string;
    }>;
    authorizationSources: string[];
    gates: string[];
    evidence: Array<{
        id: string;
        references: string[];
        revision: string | null;
    }>;
    children: string[];
    allowedActions: string[];
    nextAction: string;
}
export declare function checkpoint(state: TaskState, branch: BranchEntry[], repo: RepositoryIdentity | undefined): RecoveryCheckpoint | undefined;
export interface RecoveryObservation {
    operation: string;
    authorizationSource?: string;
    authorizationRevision?: string;
    prHeads?: Array<{
        url: string;
        head: string;
    }>;
    children?: Array<{
        runId: string;
        status: "running" | "completed" | "failed";
    }>;
}
export declare function recoveryChecks(saved: RecoveryCheckpoint, current: RecoveryCheckpoint | undefined, observation?: RecoveryObservation): {
    identity: Verdict;
    authority: Verdict;
    evidence: {
        id: string;
        result: Verdict;
    }[];
    children: Verdict;
    pr: Verdict;
    operation: string | null;
    authorityGranted: boolean;
    instruction: string;
};
export declare function latestCheckpoint(branch: BranchEntry[]): RecoveryCheckpoint | undefined;
