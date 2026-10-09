// Sanitized from historical session 01a1195b, lines 1171/1173. IDs and finding
// are shortened; the rejected four-action shape and cohesive wording are retained.
export const detailedRemediation = {
	task_id: "T1",
	reason:
		"Review found custom certificate parsing should use library-backed validation",
	before_step_id: "T1-S2",
	plan_steps: [
		{
			text: "Replace custom PEM parsing with library-backed TLS validation",
			expectedOutput:
				"The preflight uses a maintained certificate library to parse and validate CA/server certificate chains, rejects malformed or truncated material, preserves leaf-plus-intermediate support, and has focused regression tests",
			criterionIds: ["T1-AC1"],
			evidenceRequired: true,
			allowedActions: [
				"Inspect service dependency/style guidance and available certificate libraries",
				"Implement library-backed validation, direct dependency and focused regression tests as needed",
				"Run safe service tests, Ruff and Pyright",
			],
			decompositionStatus: "atomic" as const,
			granularityCheck: {
				unit: "deliverable" as const,
				boundedScope:
					"Replace only the TLS preflight's custom PEM parsing/verification implementation and its direct service dependency/tests; preserve the Terraform route and do not change cluster state",
				verificationPlan:
					"Run safe service tests, type checks and lint; confirm valid chains pass and malformed/mixed-CA inputs fail",
				isAtomic: true,
				reason:
					"One cohesive validation outcome with package, implementation and regression-test verification",
				canBeDoneInOneAgentAction: true,
				hasSingleObservableOutput: true,
				hasSingleVerificationMethod: true,
				hasNoHiddenSubtasks: true,
			},
		},
	],
};

const step = detailedRemediation.plan_steps[0];
export const fourActionsRemediation = {
	...detailedRemediation,
	plan_steps: [
		{
			...step,
			allowedActions: [
				"Read service dependency/style guidance and inspect available certificate libraries",
				"Add a direct package dependency if required and update the lock through the repository workflow",
				"Replace custom PEM regex handling with library-backed validation and cover malformed, mixed-CA, expiry, hostname and chain cases",
				"Run safe service tests, Ruff, and Pyright",
			],
		},
	],
};

export const compactRemediation = {
	task_id: detailedRemediation.task_id,
	before_step_id: detailedRemediation.before_step_id,
	remediation: {
		finding: detailedRemediation.reason,
		deliverable: step.expectedOutput,
		boundedScope: step.granularityCheck.boundedScope,
		verification: step.granularityCheck.verificationPlan,
		atomic: true,
		criterionIds: step.criterionIds,
	},
};

export const compactExample = {
	task_id: "T1",
	before_step_id: "T1-S2",
	remediation: {
		finding:
			"Review found the trust root reference still shares private-key material",
		deliverable: "Reference a CA-only trust Secret and test its exact name",
		boundedScope:
			"Only the backend trust reference and its focused assertion; exclude private keys and cluster changes",
		verification:
			"Run the focused trust-reference regression test and confirm the CA-only Secret name",
		atomic: true,
		criterionIds: ["T1-AC1"],
	},
};
