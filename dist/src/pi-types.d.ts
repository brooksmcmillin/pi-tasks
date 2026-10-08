import type { Schema } from "./schema.ts";
import type { BranchEntry } from "./store.ts";
export interface ToolResult {
    content: Array<{
        type: "text";
        text: string;
    }>;
    details?: unknown;
    isError?: boolean;
}
export interface ToolDefinition<TParams extends Record<string, unknown>> {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: Schema;
    execute(toolCallId: string, params: TParams, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ExtensionContext): Promise<ToolResult>;
}
export interface RegisteredCommand {
    description: string;
    handler(args: string, ctx: ExtensionContext): Promise<void> | void;
}
export interface TurnEndEvent {
    message: {
        role: string;
        stopReason?: string;
    };
}
export interface SettlementEvent {
    outcome: "completed" | "aborted" | "error";
    continue: boolean;
    context: {
        canContinue: boolean;
        pendingMessages: unknown[];
    };
    entries?: SettlementEntry[];
}
export type SettlementEntry = {
    type: "custom";
    customType: string;
    data?: unknown;
} | {
    type: "custom_message";
    customType: string;
    content: string;
    display: boolean;
};
export interface SettlementResult {
    entries: SettlementEntry[];
    continue: true;
}
export interface TaskToolResultEvent {
    toolName: string;
    isError: boolean;
    input: Record<string, unknown>;
    details?: unknown;
}
export interface ExtensionAPI {
    events: {
        emit<T = unknown>(event: string, data: T): void;
        on?(event: string, handler: (data: unknown) => void): () => void;
    };
    on(event: "session_start" | "session_tree" | "input" | "session_shutdown", handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void): void;
    on(event: "session_before_compact", handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void): void;
    on(event: "turn_end", handler: (event: TurnEndEvent, ctx: ExtensionContext) => Promise<void> | void): void;
    on(event: "agent_before_settle", handler: (event: SettlementEvent, ctx: ExtensionContext) => SettlementResult | undefined): void;
    on(event: "tool_result", handler: (event: TaskToolResultEvent, ctx: ExtensionContext) => Promise<void> | void): void;
    sendMessage?(message: {
        customType: string;
        content: string;
        display: boolean;
    }, options: {
        deliverAs: "followUp";
    }): void;
    registerTool<TParams extends Record<string, unknown>>(tool: ToolDefinition<TParams>): void;
    registerCommand(name: string, options: RegisteredCommand): void;
    appendEntry<T = unknown>(customType: string, data?: T): void;
    getActiveTools?(): string[];
    getAllTools?(): Array<{
        name: string;
    }>;
    setActiveTools?(names: string[]): void;
}
export interface ExtensionContext {
    signal?: AbortSignal;
    hasPendingMessages?(): boolean;
    sessionManager: {
        getBranch(): BranchEntry[];
        getSessionId?(): string;
    };
    ui: {
        notify(message: string, type?: "info" | "warning" | "error"): void;
        setStatus(key: string, text: string | undefined): void;
        setWidget(key: string, content: string[] | undefined, options?: {
            placement?: "aboveEditor" | "belowEditor";
        }): void;
    };
}
