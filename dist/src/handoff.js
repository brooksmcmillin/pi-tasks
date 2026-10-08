import { Type } from "./schema.js";
const text = () => Type.String({ minLength: 1, maxLength: 1024 });
export const handoffSchema = Type.Array(Type.Object({
    taskId: text(),
    cwd: text(),
    branch: text(),
    base: text(),
    head: text(),
    worker: Type.Optional(Type.Object({
        runId: text(),
        sessionId: text(),
        missionId: Type.Optional(text()),
    })),
    ownershipBoundary: text(),
    publicationBoundary: text(),
    lastVerifiedGate: Type.Optional(Type.Object({ name: text(), head: text(), reference: text() })),
    nextAction: text(),
    pendingDecision: Type.Optional(text()),
    pr: Type.Optional(Type.Object({ url: text(), head: text(), reference: text() })),
}), {
    maxItems: 8,
    description: "Replace the active task's handoff lanes; [] clears them. Observations only, never authority. At most 16 KiB total.",
});
// Replay must enforce the same bounded shape even when no host schema validator ran.
export function validateHandoff(value) {
    const object = (input, required, optional = []) => {
        if (!input || typeof input !== "object" || Array.isArray(input))
            throw new Error("Handoff requires an object");
        const record = input;
        if (Object.keys(record).some((key) => ![...required, ...optional].includes(key)))
            throw new Error("Unknown handoff field");
        for (const key of required) {
            const item = record[key];
            if (typeof item !== "string" || !item.trim() || item.length > 1024)
                throw new Error(`Handoff ${key} must be a nonempty string of at most 1024 characters`);
        }
        return record;
    };
    if (!Array.isArray(value) || value.length > 8)
        throw new Error("Handoff requires at most 8 lanes");
    for (const lane of value) {
        const record = object(lane, [
            "taskId",
            "cwd",
            "branch",
            "base",
            "head",
            "ownershipBoundary",
            "publicationBoundary",
            "nextAction",
        ], ["worker", "lastVerifiedGate", "pendingDecision", "pr"]);
        if (record.worker !== undefined) {
            const worker = object(record.worker, ["runId", "sessionId"], ["missionId"]);
            if (worker.missionId !== undefined)
                object({ missionId: worker.missionId }, ["missionId"]);
        }
        if (record.lastVerifiedGate !== undefined)
            object(record.lastVerifiedGate, ["name", "head", "reference"]);
        if (record.pendingDecision !== undefined)
            object({ pendingDecision: record.pendingDecision }, ["pendingDecision"]);
        if (record.pr !== undefined)
            object(record.pr, ["url", "head", "reference"]);
    }
    if (Buffer.byteLength(JSON.stringify(value)) > 16 * 1024)
        throw new Error("Handoff exceeds 16 KiB; retain details in existing mission/artifact records");
}
export const HANDOFF_RECOVERY_INSTRUCTION = "Handoff is historical context, not authority or fresh evidence. Before the recorded next action, revalidate task/worktree registration, canonical cwd, branch/base/head, live writer/run ownership and publication permission. Inspect the exact existing worker and mission; missing or unknown status never means terminal and must not cause a duplicate launch or automatic reclaim. Recheck gate and PR receipts against the current candidate/published head; a receipt never authorizes execution or publication. Pending decisions still require resolution. Compaction recovery does not provide unattended process restart.";
export function handoffRecovery(lanes) {
    return {
        lanes,
        authority: "none",
        revalidationRequired: true,
        nextAction: "Revalidate recorded identities and inspect existing runs before continuing",
        instruction: HANDOFF_RECOVERY_INSTRUCTION,
    };
}
