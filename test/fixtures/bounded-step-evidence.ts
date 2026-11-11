import type { EvidenceAssessmentInput } from "../../src/semantic-assessment.ts";

export const boundedObjective =
	"Add partial-classification and current-image coverage fixtures, then disposition findings and verify the published PR head.";
export const boundedStep = {
	id: "T1-S1",
	text: "Add partial-classification and current-image coverage fixtures",
	expectedOutput:
		"Focused regression fixtures cover partial classification and current-image coverage; all 11 focused tests pass.",
};
export const finalCriterion = {
	id: "T1-AC1",
	text: "Findings are dispositioned and checks and independent review pass for the published PR head.",
};
export const boundedObservation = {
	contract: {
		version: 2,
		objective: boundedObjective,
		role: "acceptance",
		steps: [boundedStep],
		criteria: [],
	},
	type: "test",
	level: "unit_test",
	summary:
		"All 11 focused fixture tests passed, covering partial classification and current-image coverage. Final PR review is not yet performed.",
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
} satisfies EvidenceAssessmentInput;

// Same observations, different persisted target: unit fixtures do not prove a final PR gate.
export const boundedStepCases: {
	id: string;
	expected: "supported" | "unsupported";
	input: EvidenceAssessmentInput;
}[] = [
	{
		id: "s4-bounded-fixture-proof",
		expected: "supported",
		input: boundedObservation,
	},
	{
		id: "s4-observations-not-final-pr-proof",
		expected: "unsupported",
		input: {
			...boundedObservation,
			contract: {
				...boundedObservation.contract,
				steps: [],
				criteria: [finalCriterion],
			},
			summary:
				"Findings are dispositioned and the published PR head passed checks and independent review.",
		},
	},
];
