import type { ExtensionAPI } from "./pi-types.ts";
import type { TaskRuntimeStore } from "./store.ts";
/** Native compaction is never replaced; the pilot only requests it while idle. */
export declare function registerCompactionPilot(pi: ExtensionAPI, store: TaskRuntimeStore, waiting: () => boolean): {
    reset: () => void;
    observeTool: (event: import("./pi-types.ts").TaskToolResultEvent) => void;
    before: (event: {
        customInstructions?: string;
        preparation: {
            settings: {
                keepRecentTokens: number;
            };
        };
    }) => {
        cancel: true;
    } | undefined;
    shutdown: () => void;
};
