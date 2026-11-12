import { type IdGenerator } from "./ids.ts";
import { type TaskState } from "./model.ts";
import type { ExtensionAPI } from "./pi-types.ts";
import { type TaskRuntimeStore } from "./store.ts";
export declare const EXTERNAL_TASK_GUIDANCE = "For Nexus-managed work, Nexus is authoritative and Pi local plans are optional working aids. Continue from durable task and repository evidence without creating, importing, reconstructing, repairing or completing a duplicate Pi record. Missing, stale or malformed local state and local step/evidence IDs do not gate authorized work or closeout. Local history remains readable provenance, not current authorization or verification. Preserve live ownership, formal dependencies, human decisions, safe worktrees, review, CI and verification; evidence for an obsolete commit is not current proof.";
/** Reconciles only registered pi-tasks tools without widening host restrictions. */
export declare function reconcileTaskTools(pi: ExtensionAPI, state: TaskState): void;
export declare function registerTaskTools(pi: ExtensionAPI, store: TaskRuntimeStore, idGenerator?: IdGenerator): void;
