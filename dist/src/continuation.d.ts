import type { TaskState } from "./model.ts";
/** One advisory per input, not an automatic task-completion loop. */
export declare function createContinuationAdvisory(): {
    reset(): void;
    observeToolResult(name: string, isError: boolean, input: Record<string, unknown>, details?: unknown): void;
    take(state: TaskState): string | undefined;
};
