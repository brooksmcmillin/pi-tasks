import { assessPlanSemantics, SemanticAssessmentError, } from "./semantic-assessment.js";
export const SEMANTIC_CAPABILITY_STATUS_ID = "pi-tasks-semantic";
const STRATEGY_LABELS = {
    pi_classifier: "Pi classifier",
    pi_chat: "Pi chat",
    omp_ephemeral: "OMP ephemeral",
};
const UNAVAILABLE_NOTIFICATION = "pi-tasks semantic assessment is unavailable. Planning, repair, atomic classification, and passing evidence mutations will fail closed. Run /tasks doctor.";
export async function inspectSemanticCapabilities(ctx) {
    const classifier = await inspectClassifier(ctx);
    const piChat = inspectPiChat(ctx);
    const ompEphemeral = inspectOmpEphemeral(ctx);
    const capabilities = [classifier, piChat, ompEphemeral];
    const preferred = capabilities.find((capability) => capability.state === "available");
    const hasError = capabilities.some((capability) => capability.state === "error");
    return {
        overall: preferred ? (hasError ? "degraded" : "ready") : "unavailable",
        ...(preferred ? { preferredStrategy: preferred.strategy } : {}),
        capabilities,
        ...(ctx.model
            ? { selectedModel: `${ctx.model.provider}/${ctx.model.id}` }
            : {}),
    };
}
export function formatSemanticCapabilityReport(report, liveProbe) {
    const preferred = report.preferredStrategy
        ? ` via ${STRATEGY_LABELS[report.preferredStrategy]}`
        : "";
    const lines = [
        "pi-tasks semantic doctor",
        `Overall: ${report.overall.toUpperCase()}${preferred}`,
        "Static capability check (no model request):",
        ...report.capabilities.map((capability) => `- ${capability.label}: ${capability.state} — ${capability.detail}`),
        `Current model: ${report.selectedModel ?? "none"}`,
        "Protected mutations: task_plan, task_decompose, task_replan, task_rework, task_update atomic classification, and passing task_evidence/task_verify_step/task_evidence_batch.",
    ];
    if (!liveProbe) {
        lines.push("Live probe: not run.", "Run /tasks doctor live to send one synthetic semantic assessment. Task state will not change.");
    }
    else if (liveProbe.status === "passed") {
        const usage = liveProbe.usage
            ? `, ${liveProbe.usage.totalTokens} tokens`
            : "";
        lines.push(`Live probe: PASS via ${liveProbe.strategy ? STRATEGY_LABELS[liveProbe.strategy] : "native assessor"} (${liveProbe.provider ?? "unknown"}/${liveProbe.model ?? "unknown"}, ${liveProbe.durationMs} ms${usage}).`, "Task state: unchanged.");
    }
    else {
        lines.push(`Live probe: FAIL [${liveProbe.code ?? "unknown"}] ${liveProbe.message ?? "Semantic assessment failed."} (${liveProbe.durationMs} ms).`, "Task state: unchanged.");
    }
    if (report.overall === "unavailable" || liveProbe?.status === "failed") {
        lines.push("Recovery: select a Pi model with streamSimple(), enable a Pi classifier, or run under Oh My Pi with runEphemeralTurn(); then rerun /tasks doctor live.");
    }
    return lines.join("\n");
}
export function createSemanticCapabilityMonitor() {
    let refreshSequence = 0;
    let lastUnavailableSignature;
    const applyReport = (ctx, report, notifyUnavailable) => {
        if (report.overall !== "unavailable") {
            ctx.ui.setStatus(SEMANTIC_CAPABILITY_STATUS_ID, undefined);
            lastUnavailableSignature = undefined;
            return;
        }
        ctx.ui.setStatus(SEMANTIC_CAPABILITY_STATUS_ID, "semantic unavailable · /tasks doctor");
        const signature = report.capabilities
            .map((capability) => `${capability.strategy}:${capability.state}`)
            .join("|");
        if (notifyUnavailable && signature !== lastUnavailableSignature) {
            ctx.ui.notify(UNAVAILABLE_NOTIFICATION, "warning");
        }
        lastUnavailableSignature = signature;
    };
    return {
        inspect: inspectSemanticCapabilities,
        async refresh(ctx) {
            const sequence = ++refreshSequence;
            const report = await inspectSemanticCapabilities(ctx);
            if (sequence === refreshSequence) {
                applyReport(ctx, report, true);
            }
            return report;
        },
        async doctor(ctx, options = {}) {
            const report = await inspectSemanticCapabilities(ctx);
            applyReport(ctx, report, false);
            const liveProbe = options.live
                ? await runSemanticLiveProbe(ctx)
                : undefined;
            return {
                report,
                ...(liveProbe ? { liveProbe } : {}),
                text: formatSemanticCapabilityReport(report, liveProbe),
            };
        },
    };
}
async function inspectClassifier(ctx) {
    const registry = ctx.modelRegistry;
    if (!registry?.getAvailableOfType || !registry.classify) {
        return capability("pi_classifier", "unavailable", "modelRegistry classifier APIs are not both available");
    }
    try {
        const models = await registry.getAvailableOfType("classifier");
        const [first] = models;
        if (!first) {
            return capability("pi_classifier", "unavailable", "no classifier model is available");
        }
        return capability("pi_classifier", "available", `${models.length} model${models.length === 1 ? "" : "s"}; first ${first.provider}/${first.id}`);
    }
    catch (error) {
        return capability("pi_classifier", "error", `classifier discovery failed: ${errorMessage(error)}`);
    }
}
function inspectPiChat(ctx) {
    if (!ctx.modelRegistry?.streamSimple) {
        return capability("pi_chat", "unavailable", "modelRegistry.streamSimple() is not available");
    }
    if (!ctx.model) {
        return capability("pi_chat", "unavailable", "no current Pi model is selected");
    }
    return capability("pi_chat", "available", `current model ${ctx.model.provider}/${ctx.model.id}`);
}
function inspectOmpEphemeral(ctx) {
    return ctx.runEphemeralTurn
        ? capability("omp_ephemeral", "available", "runEphemeralTurn() is available")
        : capability("omp_ephemeral", "unavailable", "runEphemeralTurn() is not available");
}
function capability(strategy, state, detail) {
    return {
        strategy,
        label: STRATEGY_LABELS[strategy],
        state,
        detail,
    };
}
async function runSemanticLiveProbe(ctx) {
    const startedAt = Date.now();
    try {
        const result = await assessPlanSemantics(ctx, {
            title: "pi-tasks semantic health probe",
            objective: "Confirm that the native semantic boundary can classify one concrete read operation",
            acceptanceCriteria: ["The probe returns a typed semantic assessment"],
            steps: [
                {
                    text: "Read the semantic capability marker from this synthetic probe payload",
                    expectedOutput: "The assessment identifies one concrete read operation",
                    criterionIds: [],
                    evidenceRequired: false,
                    allowedActions: ["inspect only the supplied synthetic probe text"],
                },
            ],
        }, ctx.signal);
        const provenance = result.assessment.provenance;
        return {
            status: "passed",
            durationMs: Date.now() - startedAt,
            strategy: provenance.strategy,
            provider: provenance.provider,
            model: provenance.model,
            ...(result.usage ? { usage: result.usage } : {}),
        };
    }
    catch (error) {
        return {
            status: "failed",
            durationMs: Date.now() - startedAt,
            code: error instanceof SemanticAssessmentError
                ? error.code
                : "unexpected_error",
            message: errorMessage(error),
            ...(error instanceof SemanticAssessmentError && error.usage
                ? { usage: error.usage }
                : {}),
        };
    }
}
function errorMessage(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.replaceAll(/\s+/g, " ").trim().slice(0, 240);
}
