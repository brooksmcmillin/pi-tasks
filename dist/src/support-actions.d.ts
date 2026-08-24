/**
 * Support actions are safe, non-mutating local operations (reads, searches,
 * tool/instruction discovery) that an agent must always be able to perform
 * without first decomposing a plan step just to unlock them. They never
 * mutate repo or task state, so they are admissible regardless of a step's
 * decomposition status.
 *
 * This module also flags plan-step text that is itself just a read/instruction
 * mechanic or a commit mechanic wearing a deliverable step's clothing. Those
 * should never be modeled as nested plan steps: reads belong outside the plan
 * entirely (as an always-admissible support action), and commit mechanics
 * belong inside the parent deliverable step's own execution, not as a
 * separate nested step.
 */
export declare const SUPPORT_ACTIONS: readonly ["read", "search", "grep", "glob", "list", "instruction_load", "tool_discovery"];
export type SupportAction = (typeof SUPPORT_ACTIONS)[number];
/** True when `action` is a tool-name-shaped string identifying a support action. */
export declare function isSupportAction(action: string): boolean;
export type MechanicStepKind = "read" | "commit";
/**
 * Classifies plan-step text whose entire content is a read/instruction-load
 * mechanic or a commit mechanic, rather than a deliverable unit of work.
 * Returns undefined when the text is not purely a mechanic action.
 */
export declare function classifyMechanicStep(text: string): MechanicStepKind | undefined;
export declare function mechanicStepMessage(kind: MechanicStepKind, text: string): string;
