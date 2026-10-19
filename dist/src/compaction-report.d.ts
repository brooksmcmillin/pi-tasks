import type { TelemetryRecord } from "./compaction-telemetry.ts";
export interface ReportLabels {
    /** Keys are telemetry digests, never raw session/task identifiers. */
    tasks?: Record<string, {
        taskClass?: string;
        startedAt?: string;
        completedAt?: string;
        status?: "complete" | "incomplete" | "abandoned";
    }>;
    phases?: Record<string, string>;
}
export declare function distribution(values: (number | null)[]): {
    n: number;
    missing: number;
    median: number | null;
    p90: number | null;
};
/** Metadata-only observational report; no adoption or execution authority is granted. */
export declare function buildReport(input: TelemetryRecord[], from: string, to: string, labels?: ReportLabels, invalidFiles?: number): {
    schemaVersion: number;
    period: {
        from: string;
        to: string;
        timezone: string;
    };
    quality: {
        invalidFiles: number;
        conflictingEvents: number;
        assignmentConflicts: number;
        replayedEvents: number;
        sessions: number;
        unknownRootSessions: number;
        unknownCohortRoots: number;
    };
    denominator: string;
    roots: {
        rootId: string;
        cohort: string;
        assignmentConflict: boolean;
        children: number;
        sessions: number;
        activeInPeriod: boolean;
        sessionsWithoutShutdown: number;
        tasks: {
            taskId: string;
            cohort: string;
            taskClass: string;
            status: string;
            durationMs: number | null;
        }[];
    }[];
    cohorts: {
        events: number;
        roots: number;
        phaseDurationMs: {
            n: number;
            missing: number;
            median: number | null;
            p90: number | null;
        };
        compactions: {
            attempts: number;
            failures: number;
            aborted: number;
            success: number;
            incomplete: number;
            orphanOutcomes: number;
            retrySignals: number;
            retryUnknown: number;
            durationMs: {
                n: number;
                missing: number;
                median: number | null;
                p90: number | null;
            };
            contextBefore: {
                n: number;
                missing: number;
                median: number | null;
                p90: number | null;
            };
            contextAfter: {
                n: number;
                missing: number;
                median: number | null;
                p90: number | null;
            };
        };
        recovery: {
            opportunities: number;
            checks: {
                [k: string]: {
                    pass: number;
                    mismatch: number;
                    unknown: number;
                };
            };
            usefulActionLatencyMs: {
                n: number;
                missing: number;
                median: number | null;
                p90: number | null;
            };
        };
        usage: {
            [k: string]: {
                knownTotal: number;
                n: number;
                missing: number;
                median: number | null;
                p90: number | null;
            };
        };
        cost: {
            knownTotal: number;
            complete: boolean;
            n: number;
            missing: number;
            median: number | null;
            p90: number | null;
        };
        proxies: {
            rereads: null;
            repeatedEvidenceReferences: number;
            limitation: string;
        };
        cohort: string;
        assignedRoots: number;
        activeRoots: number;
        incompleteTasks: number;
        abandonedTasks: number;
        taskDurationMs: {
            n: number;
            missing: number;
            median: number | null;
            p90: number | null;
        };
    }[];
    strata: {
        events: number;
        roots: number;
        phaseDurationMs: {
            n: number;
            missing: number;
            median: number | null;
            p90: number | null;
        };
        compactions: {
            attempts: number;
            failures: number;
            aborted: number;
            success: number;
            incomplete: number;
            orphanOutcomes: number;
            retrySignals: number;
            retryUnknown: number;
            durationMs: {
                n: number;
                missing: number;
                median: number | null;
                p90: number | null;
            };
            contextBefore: {
                n: number;
                missing: number;
                median: number | null;
                p90: number | null;
            };
            contextAfter: {
                n: number;
                missing: number;
                median: number | null;
                p90: number | null;
            };
        };
        recovery: {
            opportunities: number;
            checks: {
                [k: string]: {
                    pass: number;
                    mismatch: number;
                    unknown: number;
                };
            };
            usefulActionLatencyMs: {
                n: number;
                missing: number;
                median: number | null;
                p90: number | null;
            };
        };
        usage: {
            [k: string]: {
                knownTotal: number;
                n: number;
                missing: number;
                median: number | null;
                p90: number | null;
            };
        };
        cost: {
            knownTotal: number;
            complete: boolean;
            n: number;
            missing: number;
            median: number | null;
            p90: number | null;
        };
        proxies: {
            rereads: null;
            repeatedEvidenceReferences: number;
            limitation: string;
        };
        dimensions: (string | null)[];
    }[];
    stratumDimensions: string[];
    conclusion: {
        adopt: boolean;
        reason: string;
    };
};
export type CompactionReport = ReturnType<typeof buildReport>;
