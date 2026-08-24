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
];
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
export function isSupportAction(action) {
    const trimmed = action.trim();
    if (!trimmed)
        return false;
    return SUPPORT_ACTION_TOOL_PATTERNS.some((pattern) => pattern.test(trimmed));
}
const READ_MECHANIC_PATTERNS = [
    /^\s*read\b/i,
    /^\s*(load|review)\s+(the\s+)?(mandatory\s+)?(workflow\s+)?instructions?\b/i,
    /^\s*(perform|run)?\s*instruction(s)?\s+(load|loading)\b/i,
];
const COMMIT_MECHANIC_PATTERNS = [
    /^\s*git\s+commit\b/i,
    /^\s*(create|make|write|prepare)\s+(a\s+)?commit\b/i,
    /^\s*commit\s+(the\s+)?(changes|work|code)\b/i,
];
/**
 * Words that, when present in the text remaining after stripping a matched
 * mechanic lead phrase, indicate the step does substantive work beyond the
 * mechanic itself (validation, parsing, further action, etc.) and therefore
 * is NOT a pure mechanic step.
 */
const SUBSTANTIVE_REMAINDER_MARKERS = /\b(and|then|but|so that|to ensure|,|;)\b|,/i;
const ACTION_VERB_MARKERS = /\b(validate|validating|confirm|confirming|generate|generating|parse|parsing|verify|verifying|check|checking|ensure|ensuring|create|creating|write|writing|implement|implementing|analyze|analyzing|summarize|summarizing|process|processing|compute|computing|apply|applying|update|updating|build|building|test|testing|review|reviewing|handle|handling)\b/i;
/** Maximum word count for an allowed trailing object noun phrase (e.g. "the workflow instructions"). */
const MAX_TRAILING_OBJECT_WORDS = 6;
/**
 * Given text and a lead-phrase regex anchored at the start, returns whether
 * the ENTIRE text is essentially just that lead phrase plus, at most, a
 * short trailing object noun phrase (e.g. "the mandatory workflow
 * instructions", "the deployment runbook"). Any additional clause, verb, or
 * conjunction in the remainder means the step is substantive deliverable
 * work wearing the mechanic's opening words, not a pure mechanic.
 */
function isPureMechanic(trimmed, leadPattern) {
    const match = trimmed.match(leadPattern);
    if (!match)
        return false;
    let remainder = trimmed.slice(match[0].length);
    remainder = remainder.replace(/^[\s,:;.-]+/, "").replace(/[\s,:;.-]+$/, "");
    if (remainder === "")
        return true;
    if (SUBSTANTIVE_REMAINDER_MARKERS.test(remainder))
        return false;
    if (ACTION_VERB_MARKERS.test(remainder))
        return false;
    const words = remainder.split(/\s+/).filter(Boolean);
    if (words.length > MAX_TRAILING_OBJECT_WORDS)
        return false;
    return true;
}
/**
 * Classifies plan-step text whose entire content is a read/instruction-load
 * mechanic or a commit mechanic, rather than a deliverable unit of work.
 * Returns undefined when the text is not purely a mechanic action.
 */
export function classifyMechanicStep(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return undefined;
    if (READ_MECHANIC_PATTERNS.some((pattern) => isPureMechanic(trimmed, pattern))) {
        return "read";
    }
    if (COMMIT_MECHANIC_PATTERNS.some((pattern) => isPureMechanic(trimmed, pattern))) {
        return "commit";
    }
    return undefined;
}
export function mechanicStepMessage(kind, text) {
    if (kind === "read") {
        return `Plan step "${text}" is a read/instruction-load mechanic, not a deliverable unit of work; reads are always-admissible support actions (${SUPPORT_ACTIONS.join(", ")}) and must not be modeled as a nested plan step.`;
    }
    return `Plan step "${text}" is a commit mechanic, not a deliverable unit of work; handle it inside the parent step's own execution/allowedActions rather than as a separate nested plan step.`;
}
