export const PILOT_VERSION = "phase-checkpoint-v1";
export const COHORT_ENTRY = "pi-tasks:compaction-cohort";
export function isAssignment(value) {
    if (!value || typeof value !== "object")
        return false;
    const a = value;
    return (a.version === 1 &&
        a.policy === PILOT_VERSION &&
        typeof a.rootSessionId === "string" &&
        a.rootSessionId.length > 0 &&
        typeof a.rootTaskId === "string" &&
        a.rootTaskId.length > 0 &&
        (a.cohort === "baseline" || a.cohort === "pilot"));
}
export function assignCohort(prior, rootTaskId, sessionId, optIn) {
    // Forks inherit the root assignment. Later environment changes do not rerandomize it.
    const existing = prior.find((a) => isAssignment(a) && a.rootTaskId === rootTaskId);
    if (isAssignment(existing))
        return existing;
    if (!sessionId || (optIn !== "baseline" && optIn !== "pilot"))
        return;
    return {
        version: 1,
        policy: PILOT_VERSION,
        rootSessionId: sessionId,
        rootTaskId,
        cohort: optIn,
    };
}
export function thresholds(window) {
    if (!Number.isFinite(window) || window <= 40_000)
        return;
    // Leave at least 20k for recent history and 20k for generation on small models.
    const fallback = Math.min(150_000, window - 40_000);
    const target = Math.min(125_000, Math.floor((fallback * 5) / 6));
    const eligible = Math.min(100_000, Math.floor((target * 4) / 5));
    return { eligible, target, fallback, keepRecentTokens: 20_000 };
}
export function compactionDecision(input) {
    const limits = thresholds(input.window);
    if (input.cohort !== "pilot")
        return { trigger: false, reason: "baseline" };
    if (!limits ||
        input.tokens === null ||
        !Number.isFinite(input.tokens) ||
        input.tokens < 0)
        return { trigger: false, reason: "unknown-context" };
    if (!input.betweenTurns)
        return { trigger: false, reason: "busy" };
    if (input.tokens < limits.eligible)
        return { trigger: false, reason: "below-eligibility" };
    if (!input.checkpointKnown)
        return { trigger: false, reason: "unknown-checkpoint" };
    if (input.tokens >= limits.fallback)
        return { trigger: true, reason: "fallback" };
    if (input.tokens >= limits.target && input.phaseBoundary)
        return { trigger: true, reason: "phase-target" };
    return {
        trigger: false,
        reason: input.phaseBoundary ? "before-target" : "await-phase-boundary",
    };
}
