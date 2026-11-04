import type { ExtensionAPI } from "./pi-types.ts";
import { type SemanticCapabilityMonitor } from "./semantic-capability.ts";
import type { TaskRuntimeStore } from "./store.ts";
export declare function registerTaskCommands(pi: ExtensionAPI, store: TaskRuntimeStore, semanticMonitor?: SemanticCapabilityMonitor): void;
