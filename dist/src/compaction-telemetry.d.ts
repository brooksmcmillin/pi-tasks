export declare const PHASE_EVENT = "pi-tasks:phase";
export declare const TELEMETRY_VERSION = 1;
type ObjectValue = Record<string, unknown>;
export declare const object: (value: unknown) => ObjectValue;
export declare const identity: (value: unknown) => string | null;
export declare function usage(value: unknown): {
    scope: "operation";
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    totalTokens: number | null;
    cost: {
        input: number | null;
        output: number | null;
        cacheRead: number | null;
        cacheWrite: number | null;
        total: number | null;
    };
};
declare const POLICY_DECISIONS: readonly ["baseline", "unknown-context", "busy", "below-eligibility", "unknown-checkpoint", "fallback", "phase-target", "before-target", "await-phase-boundary", "retention-mismatch"];
export interface TelemetryRecord {
    policyDecision?: (typeof POLICY_DECISIONS)[number];
    schemaVersion: 1;
    sequence: number;
    id: string;
    kind: "session_start" | "session_end" | "phase_start" | "phase_end" | "checkpoint" | "recovery" | "useful_action" | "usage" | "compaction_start" | "compaction_end";
    timestamp: string;
    sourceTimestamp: string | null;
    sessionId: string;
    rootId: string | null;
    parentId: string | null;
    taskId: string | null;
    phaseId: string | null;
    compactionId: string | null;
    checkpointId: string | null;
    evidenceId: string | null;
    policyVersion: string | null;
    configVersion: string | null;
    cohort: "baseline" | "pilot" | null;
    provider: string | null;
    model: string | null;
    context: {
        tokens: number | null;
        window: number | null;
        provenance: "runtime_estimate" | "preparation" | "unknown";
    };
    usage: ReturnType<typeof usage>;
    outcome: "success" | "failure" | "abort" | "unknown" | null;
    reason: "manual" | "threshold" | "overflow" | null;
    willRetry: boolean | null;
    durationMs: number | null;
    missingStart: boolean;
    missingIdentity: boolean;
    recovery: {
        identity: "pass" | "mismatch" | "unknown";
        authority: "pass" | "mismatch" | "unknown";
        evidence: "pass" | "mismatch" | "unknown";
        children: "pass" | "mismatch" | "unknown";
    } | null;
}
/** Immutable, exclusive event files give replay deduplication without a second index. */
export declare class TelemetryStore {
    readonly directory: string;
    constructor(directory: string);
    put(record: TelemetryRecord): void;
    read(): {
        records: TelemetryRecord[];
        invalidFiles: number;
    };
}
export declare function coverage(records: TelemetryRecord[]): {
    incompleteCompactions: (string | null)[];
    orphanOutcomes: (string | null)[];
    incompletePhases: (string | null)[];
    sessionsWithoutEnd: string[];
};
export interface TelemetryContext {
    sessionManager: {
        getSessionId?(): string;
        getLeafId?(): string | null;
        getHeader?(): {
            id: string;
            parentSession?: string;
        } | null;
    };
    getContextUsage?(): {
        tokens: number | null;
        contextWindow: number;
    } | undefined;
    model?: {
        provider: string;
        id: string;
    };
}
export declare function createCollector(store: Pick<TelemetryStore, "put"> & Partial<Pick<TelemetryStore, "read">>, warn: () => void, now?: () => string): {
    start(context: TelemetryContext): void;
    bind(context: TelemetryContext): void;
    marker(value: unknown): void;
    before(value: unknown): void;
    complete(value: unknown, failed?: boolean): void;
    message(value: unknown): void;
    end(): void;
};
export {};
