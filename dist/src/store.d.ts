import { type ReplayResult, type TaskEvent, type TaskState } from "./model.ts";
export interface BranchEntry {
    type: string;
    customType?: string;
    data?: unknown;
    id?: string;
    timestamp?: string;
}
export interface TaskRuntimeStore {
    getState(): TaskState;
    replay(branchEntries: BranchEntry[]): ReplayResult;
    append(event: TaskEvent, appendEntry: (customType: string, data: TaskEvent) => void): TaskState;
}
export declare function createTaskRuntimeStore(initialState?: TaskState): TaskRuntimeStore;
export declare function replayBranchEntries(entries: BranchEntry[]): ReplayResult;
export declare function snapshotState(state: TaskState): Omit<TaskState, "events">;
export declare function errorText(error: unknown): string;
