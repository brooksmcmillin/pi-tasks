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

export const SUPPORT_ACTIONS = [
	"read",
	"search",
	"grep",
	"glob",
	"list",
	"instruction_load",
	"tool_discovery",
] as const;

export type SupportAction = (typeof SUPPORT_ACTIONS)[number];

const SUPPORT_ACTION_TOOL_PATTERNS = [
	/^read$/i,
	/^read_file$/i,
	/^cat$/i,
	/^grep$/i,
	/^search$/i,
	/^glob$/i,
	/^list$/i,
	/^list_dir$/i,
	/^ls$/i,
	/^instruction_load$/i,
	/^load_instructions?$/i,
	/^tool_discovery$/i,
	/^discover_tools?$/i,
];

/** True when `action` is a tool-name-shaped string identifying a support action. */
export function isSupportAction(action: string): boolean {
	const trimmed = action.trim();
	if (!trimmed) return false;
	return SUPPORT_ACTION_TOOL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

const READ_MECHANIC_PATTERNS = [
	/^\s*read\b/i,
	/^\s*(load|review)\s+(the\s+)?(mandatory\s+)?(workflow\s+)?instructions?\b/i,
	/\binstruction(s)?\s+(load|loading)\b/i,
];

const COMMIT_MECHANIC_PATTERNS = [
	/^\s*git\s+commit\b/i,
	/^\s*(create|make|write|prepare)\s+(a\s+)?commit\b/i,
	/^\s*commit\s+(the\s+)?(changes|work|code)\b/i,
];

export type MechanicStepKind = "read" | "commit";

/**
 * Classifies plan-step text whose entire content is a read/instruction-load
 * mechanic or a commit mechanic, rather than a deliverable unit of work.
 * Returns undefined when the text is not purely a mechanic action.
 */
export function classifyMechanicStep(
	text: string,
): MechanicStepKind | undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	if (READ_MECHANIC_PATTERNS.some((pattern) => pattern.test(trimmed))) {
		return "read";
	}
	if (COMMIT_MECHANIC_PATTERNS.some((pattern) => pattern.test(trimmed))) {
		return "commit";
	}
	return undefined;
}

export function mechanicStepMessage(
	kind: MechanicStepKind,
	text: string,
): string {
	if (kind === "read") {
		return `Plan step "${text}" is a read/instruction-load mechanic, not a deliverable unit of work; reads are always-admissible support actions (${SUPPORT_ACTIONS.join(", ")}) and must not be modeled as a nested plan step.`;
	}
	return `Plan step "${text}" is a commit mechanic, not a deliverable unit of work; handle it inside the parent step's own execution/allowedActions rather than as a separate nested plan step.`;
}
