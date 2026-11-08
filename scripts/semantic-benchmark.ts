import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI } from "../src/pi-types.ts";
import {
	assessPlanSemantics,
	SEMANTIC_PROMPT_VERSION,
} from "../src/semantic-assessment.ts";
import { deliverableCases } from "../test/fixtures/semantic-deliverables.ts";

// Explicit opt-in development extension. It never registers task mutation tools.
export default function semanticBenchmark(pi: ExtensionAPI) {
	pi.registerCommand("semantic-benchmark", {
		description:
			"Evaluate the sanitized eight-case corpus once; argument is a new output JSON path",
		handler: async (args, ctx) => {
			const output = resolve(args.trim());
			if (!args.trim()) throw new Error("A new output path is required");
			const source = await readFile(
				new URL("../src/semantic-assessment.ts", import.meta.url),
			);
			const rows = [];
			for (const fixture of deliverableCases) {
				const started = Date.now();
				try {
					const run = await assessPlanSemantics(
						ctx,
						fixture.input,
						AbortSignal.timeout(60_000),
					);
					rows.push({
						id: fixture.id,
						expected: fixture.expected,
						agreed: run.assessment.steps[0]?.decision === fixture.expected,
						elapsedMs: Date.now() - started,
						...run,
					});
				} catch (error) {
					rows.push({
						id: fixture.id,
						expected: fixture.expected,
						agreed: false,
						elapsedMs: Date.now() - started,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}
			await writeFile(
				output,
				JSON.stringify(
					{
						observedAt: new Date().toISOString(),
						promptVersion: SEMANTIC_PROMPT_VERSION,
						assessorSourceSha256: createHash("sha256")
							.update(source)
							.digest("hex"),
						corpusSha256: createHash("sha256")
							.update(JSON.stringify(deliverableCases))
							.digest("hex"),
						model: ctx.model
							? { provider: ctx.model.provider, id: ctx.model.id }
							: null,
						administrativeRetries: 0,
						agreement: {
							matched: rows.filter((row) => row.agreed).length,
							total: rows.length,
						},
						rows,
					},
					null,
					2,
				),
				{ flag: "wx", mode: 0o600 },
			);
			ctx.ui.notify(`Semantic benchmark saved: ${output}`, "info");
		},
	});
}
