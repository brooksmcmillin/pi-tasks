import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolResult } from "../../src/pi-types.ts";
import { compactRejectionOutput } from "../../src/rejection-output.ts";

const dirs: string[] = [];
function transcript() {
	const dir = mkdtempSync(join(tmpdir(), "rejection-"));
	dirs.push(dir);
	const file = join(dir, "session.jsonl");
	writeFileSync(file, "");
	return file;
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function rejection(tool: string): ToolResult {
	return {
		isError: true,
		content: [
			{ type: "text", text: `Original full recovery: ${"🙂".repeat(20_000)}` },
		],
		details: {
			rejected: true,
			reason: `Specific failure ${"x".repeat(10_000)}`,
			retry_with: tool,
			do_not_retry_same_call: true,
			minimum_params: {
				task_id: "T1",
				quality: { command: "<replace with retained command>" },
			},
			resume: {
				blockedTools: ["task_complete"],
				recommendedTool: "task_verify_step",
			},
		},
	};
}

describe("compact rejection transcript recovery", () => {
	it.each(["task_plan", "task_evidence", "task_evidence_batch"])(
		"bounds %s without losing exact diagnostics or recovery",
		(tool) => {
			const file = transcript();
			const original = rejection(tool);
			const params = {
				task_id: "T1",
				quality: { command: `npx test ${"x".repeat(40_000)}` },
				extra: "preserve me",
			};
			const result = compactRejectionOutput(
				original,
				params,
				tool,
				"call-1",
				() => file,
			);
			expect(result.content[0].text?.length).toBeLessThanOrEqual(3000);
			expect(result.content[0].text).toContain(
				"Changed/added top-level fields: quality. Omitted: extra",
			);
			expect(result.content[0].text).toContain(
				"Adapted suggestion, not an exact retry",
			);
			expect(result.content[0].text).toContain("never invent evidence");
			expect(result.content[0].text).toContain("toolCallId=call-1");
			expect(result.details).toMatchObject(original.details ?? {});
			// Round-trip the host tool-result JSON shape, including Unicode and large arguments.
			writeFileSync(
				file,
				`${JSON.stringify({
					type: "message",
					message: { role: "toolResult", toolCallId: "call-1", ...result },
				})}\n`,
			);
			const saved = JSON.parse(readFileSync(file, "utf8"));
			expect(saved.message.details.rejectionDiagnostic).toEqual({
				toolName: tool,
				toolCallId: "call-1",
				submitted: params,
				content: original.content,
			});
		},
	);

	it("retains independent exact responses for repeated rejections", () => {
		const file = transcript();
		const results = ["first", "second"].map((id) =>
			compactRejectionOutput(
				rejection("task_plan"),
				{ title: id },
				"task_plan",
				id,
				() => file,
			),
		);
		expect(results[0].details).not.toEqual(results[1].details);
		expect(results[0].content[0].text).toContain("toolCallId=first");
		expect(results[1].content[0].text).toContain("toolCallId=second");
	});

	it("preserves full inline response when transcript storage is unavailable", () => {
		const original = rejection("task_plan");
		for (const getFile of [
			() => undefined,
			() => "/nonexistent/transcript.jsonl",
			() => {
				throw new Error("storage unavailable");
			},
		]) {
			expect(
				compactRejectionOutput(original, {}, "task_plan", "call", getFile),
			).toBe(original);
		}
	});

	it("falls back when the transcript is read-only or is a directory", () => {
		const file = transcript();
		const original = rejection("task_plan");
		chmodSync(file, 0o400);
		try {
			expect(
				compactRejectionOutput(original, {}, "task_plan", "call", () => file),
			).toBe(original);
			expect(
				compactRejectionOutput(original, {}, "task_plan", "call", () =>
					tmpdir(),
				),
			).toBe(original);
		} finally {
			chmodSync(file, 0o600);
		}
	});

	it("retains native assessment recovery instead of suggesting a structural bypass", () => {
		const file = transcript();
		const original: ToolResult = {
			isError: true,
			content: [{ type: "text", text: "No native model" }],
			details: {
				rejected: true,
				reason: "No native model",
				native_model_required: true,
				retry_with: "task_plan",
				do_not_retry_same_call: true,
			},
		};
		const result = compactRejectionOutput(
			original,
			{},
			"task_plan",
			"call",
			() => file,
		);
		expect(result.content[0].text).toContain("Restore native model capability");
		expect(result.isError).toBe(true);
		expect(result.details).toMatchObject(original.details ?? {});
	});

	it("leaves successful results and unrelated errors unchanged", () => {
		for (const result of [
			{ content: [{ type: "text", text: "success" }] },
			{
				isError: true,
				content: [{ type: "text", text: "unstructured error" }],
			},
		]) {
			expect(
				compactRejectionOutput(result, {}, "task_plan", "call", () => {
					throw new Error("must not read");
				}),
			).toBe(result);
		}
	});
});
