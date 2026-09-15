import { type IdGenerator } from "./ids.ts";
import type { TaskState } from "./model.ts";
import type { ExtensionAPI } from "./pi-types.ts";
import { type TaskRuntimeStore } from "./store.ts";
/** Reconciles only registered pi-tasks tools without widening host restrictions. */
export declare function reconcileTaskTools(pi: ExtensionAPI, state: TaskState): void;
export declare function registerTaskTools(pi: ExtensionAPI, store: TaskRuntimeStore, idGenerator?: IdGenerator): void;
