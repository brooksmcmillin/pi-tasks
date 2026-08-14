import type { TaskState } from "./model.ts";
import type { ExtensionAPI, ExtensionContext } from "./pi-types.ts";
import { type TaskStateEventReason } from "./state-events.ts";
export declare function updateTaskUi(pi: ExtensionAPI, ctx: ExtensionContext, state: TaskState, reason: TaskStateEventReason): void;
