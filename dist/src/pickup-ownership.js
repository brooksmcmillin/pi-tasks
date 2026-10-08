export const PICKUP_OWNERSHIP_EVENT = "task-continuation:ownership";
/** The pickup guard owns recovery, including exhausted and explicit boundary states. */
export function pickupOwnsRecovery(value) {
    if (!value || typeof value !== "object")
        return;
    const data = value;
    if (data.version !== 1 ||
        data.owner !== "named-task-pickup" ||
        typeof data.handled !== "boolean" ||
        typeof data.pendingAsync !== "boolean" ||
        (data.remaining !== 0 && data.remaining !== 1) ||
        typeof data.disposition !== "string" ||
        !["proceed", "blocker", "decision", "wait", "complete", "stop"].includes(data.disposition) ||
        (data.taskId !== undefined && typeof data.taskId !== "string"))
        return;
    return data.handled || data.remaining === 0 || data.pendingAsync;
}
