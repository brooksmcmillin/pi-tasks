import type { ToolResult } from "./pi-types.ts";
/** Keep recovery data in the host transcript, not a second evidence store. */
export declare function compactRejectionOutput(result: ToolResult, params: Record<string, unknown>, toolName: string, toolCallId: string, getSessionFile: () => string | undefined): ToolResult;
