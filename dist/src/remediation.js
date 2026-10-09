import { Type } from "./schema.js";
export const COMPACT_REMEDIATION_GUIDANCE = "Supply either remediation { finding, deliverable, boundedScope, verification, atomic?, criterionIds? } or the existing reason + plan_steps, never both. Compact input derives an evidence-required deliverable step and two bounded actions. Omit atomic for compound/unchecked work requiring task_decompose. atomic=true is an explicit attestation of one bounded observable outcome, one cohesive implementation/verification cycle, and no hidden subtasks; it derives all granularity flags, not evidence. before_step_id must name an open step; invalid targets never silently append.";
export function compactRemediationSchema() {
    return Type.Object({
        finding: Type.String({ minLength: 1 }),
        deliverable: Type.String({ minLength: 12 }),
        boundedScope: Type.String({ minLength: 12, maxLength: 500 }),
        verification: Type.String({ minLength: 12, maxLength: 500 }),
        atomic: Type.Optional(Type.Boolean({
            description: "Explicitly attest one bounded outcome, one cohesive implementation/verification cycle and no hidden subtasks. Defaults to needs_breakdown; do not assert true for unrelated deliverables.",
        })),
        criterionIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
    });
}
export function normalizeReworkInput(params) {
    if (params.remediation === undefined) {
        if (typeof params.reason !== "string" ||
            !params.reason.trim() ||
            !Array.isArray(params.plan_steps) ||
            params.plan_steps.length === 0) {
            throw new Error("Supply remediation or a non-empty reason and plan_steps");
        }
        return { reason: params.reason, planSteps: params.plan_steps };
    }
    if (params.reason !== undefined || params.plan_steps !== undefined) {
        throw new Error("Use remediation OR reason + plan_steps, not both");
    }
    const input = params.remediation;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("remediation must be a finding/deliverable/boundedScope/verification object");
    }
    const fields = [
        "finding",
        "deliverable",
        "boundedScope",
        "verification",
        "atomic",
        "criterionIds",
    ];
    if (Object.keys(input).some((key) => !fields.includes(key))) {
        throw new Error("remediation contains unknown fields; use finding, deliverable, boundedScope, verification, atomic and criterionIds");
    }
    for (const [field, minimum, maximum] of [
        ["finding", 1, Infinity],
        ["deliverable", 12, Infinity],
        ["boundedScope", 12, 500],
        ["verification", 12, 500],
    ]) {
        const value = input[field];
        if (typeof value !== "string" ||
            value.trim().length < minimum ||
            value.length > maximum) {
            throw new Error(`remediation.${field} requires ${minimum}${maximum === Infinity ? "+" : `–${maximum}`} characters of explicit content`);
        }
    }
    if (input.atomic !== undefined && typeof input.atomic !== "boolean") {
        throw new Error("remediation.atomic must be a boolean attestation; omit it for work needing decomposition");
    }
    if (input.criterionIds !== undefined &&
        (!Array.isArray(input.criterionIds) ||
            input.criterionIds.length === 0 ||
            input.criterionIds.some((id) => typeof id !== "string" || !id.trim()))) {
        throw new Error("remediation.criterionIds must be a non-empty array of existing criterion IDs");
    }
    const atomic = input.atomic ?? false;
    const scope = input.boundedScope.trim();
    const verification = input.verification.trim();
    return {
        reason: input.finding.trim(),
        planSteps: [
            {
                text: input.deliverable.trim(),
                expectedOutput: input.deliverable.trim(),
                ...(input.criterionIds !== undefined
                    ? { criterionIds: input.criterionIds }
                    : {}),
                evidenceRequired: true,
                allowedActions: [
                    `Remediate within: ${scope}`,
                    `Verify: ${verification}`,
                ],
                decompositionStatus: atomic ? "atomic" : "needs_breakdown",
                granularityCheck: {
                    unit: "deliverable",
                    boundedScope: scope,
                    verificationPlan: verification,
                    reason: atomic
                        ? "Author attests one bounded outcome and cohesive verification cycle without hidden subtasks"
                        : "Author has not attested atomicity; decompose before execution",
                    isAtomic: atomic,
                    canBeDoneInOneAgentAction: atomic,
                    hasSingleObservableOutput: atomic,
                    hasSingleVerificationMethod: atomic,
                    hasNoHiddenSubtasks: atomic,
                },
            },
        ],
    };
}
