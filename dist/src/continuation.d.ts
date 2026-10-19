import type { TaskState } from "./model.ts";
export declare const EXECUTION_TOOLS: Set<string>;
/** Inactive creation returns the old active task's resume contract. */
export declare function executionTaskId(name: string, input: Record<string, unknown>, details?: unknown): string | undefined;
/** One advisory per input, not an automatic task-completion loop. */
export declare function createContinuationAdvisory(): {
    relinquish(): void;
    reset(): void;
    observeToolResult(name: string, isError: boolean, input: Record<string, unknown>, details?: unknown): void;
    take(state: TaskState): string | undefined;
};
