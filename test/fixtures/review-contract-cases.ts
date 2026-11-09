import type { TaskStepInput } from "../../src/model.ts";

// Historical wording: owner-admission session 01a1b25f-ec34-742a-8919-1feb47970112.
// Expectations are a regression corpus, not preapproved plans or model responses.
export const reviewContractCases: {
	name: string;
	source: string;
	expected: "atomic" | "needs_breakdown" | "rejected";
	step: TaskStepInput;
}[] = [
	{
		name: "commit and push remain separate",
		source: "L144",
		expected: "needs_breakdown",
		step: {
			text: "Commit and push the reviewed upstream integration tree to the fork sync branch.",
			expectedOutput:
				"Remote sync branch has the exact verified upstream tree and preserves fork history.",
			allowedActions: [
				"Refresh open-PR overlap and verify push destination",
				"Commit the already-staged integration and push the feature branch",
			],
		},
	},
	{
		name: "PR creation includes preparation and receipt",
		source: "L144",
		expected: "atomic",
		step: {
			text: "Create the draft sync PR with explicit validation limitations.",
			expectedOutput:
				"Verified draft PR to fork main with matching remote head and documented baseline failures.",
			allowedActions: [
				"Refresh open-PR discovery",
				"Create and verify draft sync PR with failure evidence",
			],
		},
	},
	{
		name: "push includes destination and immediate receipt checks",
		source: "L149",
		expected: "atomic",
		step: {
			text: "Push the exact integration commit to the fork feature branch.",
			expectedOutput:
				"Remote feature branch SHA equals local integration commit.",
			allowedActions: [
				"Refresh PR overlap and verify remote",
				"Push integration commit and verify remote SHA",
			],
		},
	},
	{
		name: "review completion cannot hide repair rounds",
		source: "L725",
		expected: "needs_breakdown",
		step: {
			text: "Complete independent staged-delta review and finding disposition.",
			expectedOutput:
				"Successful affected-track reviews tied to candidate identity; any accepted defects repaired within bounded review rounds.",
			allowedActions: [
				"Release planning workflow to fresh candidate review tracks",
				"Verify findings and persist candidate review receipts/dispositions",
			],
		},
	},
	{
		name: "ledger write includes fresh identity precondition",
		source: "L1287",
		expected: "atomic",
		step: {
			text: "Persist security retry provenance bound to fresh canonical PR identity.",
			expectedOutput:
				"Locked audit ledger records new verifier provenance and unchanged fresh PR base/head for the security-only retry.",
			allowedActions: [
				"Query PR base/head and persist retry provenance under audit-state lock/CAS.",
			],
		},
	},
	{
		name: "one candidate identity verification bundle",
		source: "revised candidate contract",
		expected: "atomic",
		step: {
			text: "Establish whether the frozen candidate for review R17 still matches its identity manifest.",
			expectedOutput:
				"One read-only identity verdict covering HEAD, index tree, unstaged paths and input hashes against R17/identity.json, with all discrepancies retained.",
			allowedActions: [
				"Compare Git identity and recorded input hashes against R17/identity.json without writing the index; save the verification bundle. No staging, ledger update or dispatch.",
			],
		},
	},
	{
		name: "bundle label cannot combine unrelated claims",
		source: "negative control",
		expected: "needs_breakdown",
		step: {
			text: "Produce one verification bundle for PR 17 code correctness and the production billing service's availability.",
			expectedOutput:
				"One report with independently established code-correctness and production-availability verdicts.",
			allowedActions: [
				"Review PR 17 diff against its acceptance criteria",
				"Query production billing uptime for the last day",
			],
		},
	},
	{
		name: "ambiguous target is not a template exemption",
		source: "negative control",
		expected: "rejected",
		step: {
			text: "Use the publication template to finish whichever change is ready.",
			expectedOutput: "Everything appropriate is published.",
			allowedActions: [
				"Choose the target and infer missing permission from old receipts",
			],
		},
	},
];
