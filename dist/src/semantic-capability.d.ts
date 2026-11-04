import type { SemanticAssessmentStrategy } from "./model.ts";
import type { ExtensionContext, ModelUsage } from "./pi-types.ts";
export declare const SEMANTIC_CAPABILITY_STATUS_ID = "pi-tasks-semantic";
export type SemanticCapabilityState = "available" | "unavailable" | "error";
export type SemanticCapabilityOverallState = "ready" | "degraded" | "unavailable";
export interface SemanticStrategyCapability {
    strategy: SemanticAssessmentStrategy;
    label: string;
    state: SemanticCapabilityState;
    detail: string;
}
export interface SemanticCapabilityReport {
    overall: SemanticCapabilityOverallState;
    preferredStrategy?: SemanticAssessmentStrategy;
    capabilities: readonly [
        SemanticStrategyCapability,
        SemanticStrategyCapability,
        SemanticStrategyCapability
    ];
    selectedModel?: string;
}
export interface SemanticLiveProbeResult {
    status: "passed" | "failed";
    durationMs: number;
    strategy?: SemanticAssessmentStrategy;
    provider?: string;
    model?: string;
    usage?: ModelUsage;
    code?: string;
    message?: string;
}
export interface SemanticDoctorResult {
    report: SemanticCapabilityReport;
    liveProbe?: SemanticLiveProbeResult;
    text: string;
}
export interface SemanticCapabilityMonitor {
    inspect(ctx: ExtensionContext): Promise<SemanticCapabilityReport>;
    refresh(ctx: ExtensionContext): Promise<SemanticCapabilityReport>;
    doctor(ctx: ExtensionContext, options?: {
        live?: boolean;
    }): Promise<SemanticDoctorResult>;
}
export declare function inspectSemanticCapabilities(ctx: ExtensionContext): Promise<SemanticCapabilityReport>;
export declare function formatSemanticCapabilityReport(report: SemanticCapabilityReport, liveProbe?: SemanticLiveProbeResult): string;
export declare function createSemanticCapabilityMonitor(): SemanticCapabilityMonitor;
