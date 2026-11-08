import type {
	AcceptanceCriterion,
	Task,
	TaskEvidence,
	TaskStep,
} from "./model.ts";

export interface EvidenceContract {
	version: 1;
	objective: string;
	role: "acceptance" | "diagnostic";
	steps: { id: string; text: string; expectedOutput: string }[];
	criteria: { id: string; text: string }[];
}

/** Resolve only persisted meanings; evidence prose cannot redefine its targets. */
export function evidenceContract(
	task: Task,
	links: {
		stepIds?: string[] | undefined;
		criterionIds?: string[] | undefined;
		role?: "acceptance" | "diagnostic" | undefined;
	},
): EvidenceContract {
	const criterionIds = links.criterionIds ?? [];
	let stepIds = links.stepIds ?? [];
	if (stepIds.length === 0 && criterionIds.length > 0) {
		const matching = task.planSteps.filter((step) =>
			step.criterionIds.some((id) => criterionIds.includes(id)),
		);
		if (matching.length === 1) stepIds = matching.map((step) => step.id);
	}
	const contract: EvidenceContract = {
		version: 1,
		objective: task.objective,
		role: links.role ?? "acceptance",
		steps: [...new Set(stepIds)].map((id) => {
			const step = task.planSteps.find((candidate) => candidate.id === id);
			if (!step) throw new Error(`Plan step ${id} not found`);
			return { id, text: step.text, expectedOutput: step.expectedOutput };
		}),
		criteria: [...new Set(criterionIds)].map((id) => {
			const criterion = task.acceptanceCriteria.find(
				(candidate) => candidate.id === id,
			);
			if (!criterion) throw new Error(`Criterion ${id} not found`);
			return { id, text: criterion.text };
		}),
	};
	// Never silently omit contract text: a clipped success condition can invert meaning.
	if (JSON.stringify(contract).length > 65_536) {
		throw new Error(
			"Evidence assessment contract exceeds 65536 characters; use narrower step/criterion links",
		);
	}
	return contract;
}

/** Existing IDs are not permission to reuse proof for a different outcome. */
export function evidenceSupportsTarget(
	task: Task,
	evidence: TaskEvidence,
	target: TaskStep | AcceptanceCriterion,
): boolean {
	if (evidence.semanticAssessment?.contractVersion !== 1) return true;
	const contract = evidence.assessedContract;
	if (
		!contract ||
		contract.objective !== task.objective ||
		contract.role !== "acceptance"
	)
		return false;
	return "expectedOutput" in target
		? contract.steps.some(
				(step) =>
					step.id === target.id &&
					step.text === target.text &&
					step.expectedOutput === target.expectedOutput,
			)
		: contract.criteria.some(
				(criterion) =>
					criterion.id === target.id && criterion.text === target.text,
			);
}
