import { accessSync, constants, statSync } from "node:fs";
import type { ToolResult } from "./pi-types.ts";

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function bounded(value: string, limit: number): string {
	return value.length <= limit
		? value
		: `${value.slice(0, limit)}… [see exact diagnostic]`;
}

/** Keep recovery data in the host transcript, not a second evidence store. */
export function compactRejectionOutput(
	result: ToolResult,
	params: Record<string, unknown>,
	toolName: string,
	toolCallId: string,
	getSessionFile: () => string | undefined,
): ToolResult {
	if (!result.isError) return result;
	const recovery = record(result.details);
	if (recovery.rejected !== true) return result;
	let sessionFile: string | undefined;
	try {
		sessionFile = getSessionFile();
		if (!sessionFile) return result;
		if (!statSync(sessionFile).isFile()) return result;
		accessSync(sessionFile, constants.R_OK | constants.W_OK);
	} catch {
		// Without a usable transcript, preserve the original inline diagnostic.
		return result;
	}
	const suggestion = recovery.retry_example ?? recovery.minimum_params;
	const suggested = record(suggestion);
	const changed = Object.keys(suggested).filter(
		(key) => JSON.stringify(suggested[key]) !== JSON.stringify(params[key]),
	);
	const omitted = Object.keys(params).filter((key) => !(key in suggested));
	const retryWith =
		typeof recovery.retry_with === "string" ? recovery.retry_with : toolName;
	const transition = record(recovery.transition_recovery);
	const next =
		typeof transition.next_action === "string"
			? transition.next_action
			: recovery.native_model_required
				? `Restore native model capability before retrying ${retryWith}.`
				: `Inspect the retained recovery suggestion for ${retryWith}; correct the rejected fields before retrying.`;
	const text = [
		`Error: ${bounded(String(recovery.reason ?? "Mutation rejected"), 700)}`,
		`Recovery: ${bounded(next, 400)}`,
		`retry_with: ${bounded(retryWith, 100)}`,
		`do_not_retry_same_call: ${recovery.do_not_retry_same_call === true}`,
		...(suggestion
			? [
					`Adapted suggestion, not an exact retry. Changed/added top-level fields: ${bounded(changed.join(", ") || "none", 300)}. Omitted: ${bounded(omitted.join(", ") || "none", 300)}.`,
				]
			: []),
		"Suggestions are untested, not authority: preserve verification, ownership and user decisions; never invent evidence. Failed submissions do not prove no valid plan exists. If fields are absent from the public schema, report the mismatch rather than submitting them.",
		`Exact submission and response: ${sessionFile}, toolCallId=${toolCallId}, toolResult.details.rejectionDiagnostic. Recovery fields remain in toolResult.details.`,
	].join("\n");
	// Avoid shortening the locator itself: an unusably long locator requires fallback.
	if (text.length > 3000) return result;
	return {
		...result,
		content: [{ type: "text", text }],
		details: {
			...recovery,
			rejectionDiagnostic: {
				toolName,
				toolCallId,
				submitted: params,
				content: result.content,
			},
		},
	};
}
