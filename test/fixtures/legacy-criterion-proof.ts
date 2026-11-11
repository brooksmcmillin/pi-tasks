import type { TaskEvent } from "../../src/model.ts";

// Frozen synthetic event/hash from the contract-v1 resolver at origin/main
// 1f9ca470661631aa117c48733042d2f7af24f14d; not a replay of the private incident.
export const legacyCriterionProof: TaskEvent = {
	version: 2,
	id: "frozen-v1-criterion-only-proof",
	type: "task.evidence_added",
	taskId: "T1",
	createdAt: "2026-11-10T00:00:00.000Z",
	source: "tool",
	criterionIds: ["T1-AC1"],
	evidence: {
		id: "historical-E1",
		contractVersion: 1,
		type: "test",
		role: "acceptance",
		level: "unit_test",
		summary:
			"All 11 focused fixture tests passed, covering partial classification and current-image coverage. Final PR review is not yet performed.",
		passed: true,
		references: ["artifacts/focused-fixtures.log"],
		quality: {
			source: "focused fixture runner",
			reproducible: true,
			verifier: "tool",
			command: "npm test -- partial-classification current-image",
			artifactRefs: ["artifacts/focused-fixtures.log"],
			observedOutput:
				"11/11 tests passed: partial rows retain usable classification; current-image coverage includes expected fixtures. Findings disposition, publication, checks and independent review remain pending. This run proves only the bounded fixture step.",
		},
	},
	semanticAssessment: {
		contractVersion: 1,
		inputHash:
			"c0be75f0fe6e51d976271c71dfdf7e77c0429f2b283403275fed9a24b07d4543",
		decision: "supported",
		confidence: 0.95,
		issues: [],
		provenance: {
			version: 1,
			strategy: "pi_classifier",
			provider: "test",
			model: "frozen-v1-controlled-judgment",
			promptVersion: "2026-11-08.evidence.v2",
			inputHash:
				"c0be75f0fe6e51d976271c71dfdf7e77c0429f2b283403275fed9a24b07d4543",
			assessedAt: "2026-11-10T00:00:00.000Z",
		},
	},
};
