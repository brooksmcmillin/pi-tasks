import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
	createCollector,
	TelemetryStore,
} from "../src/compaction-telemetry.ts";

const events = 1000;
const rounds = 5;
const results: Array<{ enabled: boolean; elapsedMs: number; records: number }> =
	[];
for (let round = 0; round < rounds; round++) {
	// Alternate order; identical payload construction in both arms, no network or LLM work.
	for (const enabled of round % 2 ? [true, false] : [false, true]) {
		const directory = mkdtempSync(join(tmpdir(), "pi-telemetry-bench-"));
		try {
			const store = new TelemetryStore(directory);
			const collector = enabled
				? createCollector(store, () => {
						throw new Error("Collection failed");
					})
				: undefined;
			collector?.start({
				sessionManager: { getSessionId: () => `synthetic-${round}` },
			});
			const started = performance.now();
			for (let index = 0; index < events; index++) {
				const marker = {
					version: 1,
					kind: index % 2 ? "phase_end" : "phase_start",
					id: `marker-${index}`,
					phaseId: `phase-${Math.floor(index / 2)}`,
					taskId: "synthetic",
					cohort: "baseline",
				};
				collector?.marker(marker);
			}
			const elapsedMs = performance.now() - started;
			const read = store.read();
			assert.equal(read.invalidFiles, 0);
			assert.equal(read.records.length, enabled ? events + 1 : 0);
			results.push({ enabled, elapsedMs, records: read.records.length });
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}
}
const median = (values: number[]) =>
	values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const onMs = median(results.filter((r) => r.enabled).map((r) => r.elapsedMs));
const offMs = median(results.filter((r) => !r.enabled).map((r) => r.elapsedMs));
console.log(
	JSON.stringify(
		{
			schemaVersion: 1,
			workload:
				"synthetic phase markers; exclusive private files; startup/readback excluded",
			node: process.version,
			platform: process.platform,
			events,
			rounds,
			results,
			medianOnMs: onMs,
			medianOffMs: offMs,
			addedMicrosecondsPerEvent: ((onMs - offMs) * 1000) / events,
			limits:
				"Local instrumentation only; no real-session speed, causality or production performance claim.",
		},
		null,
		2,
	),
);
