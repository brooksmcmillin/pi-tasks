import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI } from "../src/pi-types.ts";
import {
	assessEvidenceSemantics,
	EVIDENCE_PROMPT_VERSION,
} from "../src/semantic-assessment.ts";
import { boundedStepCases } from "../test/fixtures/bounded-step-evidence.ts";
import { evidenceCases } from "../test/fixtures/semantic-evidence.ts";

// Explicit development extension: no task mutations or historical operations.
export default function evidenceBenchmark(pi: ExtensionAPI) {
	for (const [command, cases] of [
		["evidence-benchmark", evidenceCases],
		["bounded-step-benchmark", boundedStepCases],
	] as const) {
		pi.registerCommand(command, {
			description:
				"Assess the sanitized evidence corpus once; argument is a new output JSON path",
			handler: async (args, ctx) => {
				if (!args.trim()) throw new Error("A new output path is required");
				const source = await readFile(
					new URL("../src/semantic-assessment.ts", import.meta.url),
				);
				const rows = [];
				for (const fixture of cases) {
					const started = Date.now();
					try {
						const run = await assessEvidenceSemantics(
							ctx,
							fixture.input,
							AbortSignal.timeout(60_000),
						);
						rows.push({
							id: fixture.id,
							expected: fixture.expected,
							elapsedMs: Date.now() - started,
							...run,
						});
					} catch (error) {
						rows.push({
							id: fixture.id,
							expected: fixture.expected,
							elapsedMs: Date.now() - started,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}
				await writeFile(
					resolve(args.trim()),
					JSON.stringify(
						{
							observedAt: new Date().toISOString(),
							promptVersion: EVIDENCE_PROMPT_VERSION,
							assessorSourceSha256: createHash("sha256")
								.update(source)
								.digest("hex"),
							corpusSha256: createHash("sha256")
								.update(JSON.stringify(cases))
								.digest("hex"),
							contractSourceSha256: createHash("sha256")
								.update(
									await readFile(
										new URL("../src/evidence-contract.ts", import.meta.url),
									),
								)
								.digest("hex"),
							corpus: cases,
							proofLimits:
								"Synthetic bounded cases on one native model; not universal semantic correctness, historical session repair or live Trivy verification.",
							model: ctx.model
								? { provider: ctx.model.provider, id: ctx.model.id }
								: null,
							administrativeRetries: 0,
							summary: {
								total: rows.length,
								matched: rows.filter(
									(row) => row.assessment?.decision === row.expected,
								).length,
								falsePositives: rows.filter(
									(row) =>
										row.expected === "unsupported" &&
										row.assessment?.decision === "supported",
								).length,
								falseNegatives: rows.filter(
									(row) =>
										row.expected === "supported" &&
										row.assessment &&
										row.assessment.decision !== "supported",
								).length,
								errors: rows.filter((row) => row.error).length,
							},
							rows,
						},
						null,
						2,
					),
					{ flag: "wx", mode: 0o600 },
				);
				ctx.ui.notify(
					`Evidence benchmark saved: ${resolve(args.trim())}`,
					"info",
				);
			},
		});
	}
}
