import { describe, expect, it } from "vitest";
import {
	assignCohort,
	compactionDecision,
	thresholds,
} from "../../src/compaction-policy.ts";

describe("compaction cohort policy", () => {
	it("requires opt-in and preserves assignment across resume, forks and config changes", () => {
		expect(assignCohort([], "T1", "root", undefined)).toBeUndefined();
		const pilot = assignCohort([], "T1", "root", "pilot");
		expect(assignCohort([pilot], "T1", "fork", "baseline")).toEqual(pilot);
		expect(assignCohort([pilot], "T2", "fork", "baseline")?.cohort).toBe(
			"baseline",
		);
		expect(assignCohort([{ version: 99 }], "T1", "root", "pilot")).toEqual(
			pilot,
		);
	});
	const input = {
		cohort: "pilot" as const,
		tokens: 125_000,
		window: 1_000_000,
		phaseBoundary: true,
		betweenTurns: true,
		checkpointKnown: true,
	};
	it("uses 100k eligibility, 125k phase target and 150k fallback", () => {
		expect(thresholds(input.window)).toEqual({
			eligible: 100_000,
			target: 125_000,
			fallback: 150_000,
			keepRecentTokens: 20_000,
		});
		expect(compactionDecision({ ...input, tokens: 99_999 }).reason).toBe(
			"below-eligibility",
		);
		expect(compactionDecision({ ...input, tokens: 100_000 }).reason).toBe(
			"before-target",
		);
		expect(compactionDecision(input).reason).toBe("phase-target");
		expect(compactionDecision({ ...input, phaseBoundary: false }).trigger).toBe(
			false,
		);
		expect(
			compactionDecision({ ...input, tokens: 150_000, phaseBoundary: false })
				.reason,
		).toBe("fallback");
	});
	it("defers baseline, busy, missing context and unknown checkpoints", () => {
		for (const change of [
			{ cohort: "baseline" as const },
			{ betweenTurns: false },
			{ tokens: null },
			{ tokens: Number.NaN },
			{ checkpointKnown: false },
		])
			expect(compactionDecision({ ...input, ...change }).trigger).toBe(false);
	});
	it("respects smaller model windows without changing native limits", () => {
		expect(thresholds(128_000)?.fallback).toBe(88_000);
		expect(thresholds(32_000)).toBeUndefined();
		expect(
			compactionDecision({
				...input,
				window: 128_000,
				tokens: 88_000,
				phaseBoundary: false,
			}).trigger,
		).toBe(true);
	});
});
