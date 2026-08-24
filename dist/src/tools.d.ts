import { type IdGenerator } from "./ids.ts";
import type { ExtensionAPI } from "./pi-types.ts";
import { type TaskRuntimeStore } from "./store.ts";
export declare function registerTaskTools(pi: ExtensionAPI, store: TaskRuntimeStore, idGenerator?: IdGenerator): void;
