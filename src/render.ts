import type {
	Task,
	TaskExecutionMode,
	TaskResumeContext,
	TaskResumeStep,
	TaskState,
	TaskStatus,
	TaskStep,
} from "./model.ts";
import { hasFreshCriterionEvidence } from "./reducer.ts";
import { isSupportAction, SUPPORT_ACTIONS } from "./support-actions.ts";

const STATUS_ORDER: TaskStatus[] = [
	"active",
	"blocked",
	"review",
	"pending",
	"done",
	"cancelled",
];
const DETAIL_TEXT_MAX = 220;
const DETAIL_REF_MAX = 120;

export function truncateText(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (text.length <= maxWidth) return text;
	if (maxWidth === 1) return "…";
	return `${text.slice(0, maxWidth - 1)}…`;
}

export function formatStatusText(
	state: TaskState,
	maxWidth = 80,
): string | undefined {
	const active = state.activeTaskId
		? state.tasks[state.activeTaskId]
		: undefined;
	if (!active) return undefined;
	const marker =
		active.status === "blocked"
			? "blocked"
			: `${active.status} ${active.progress}%`;
	return truncateText(
		`Task ${active.id} ${marker} - ${active.nextAction ?? active.title}`,
		maxWidth,
	);
}

export function formatWidgetLines(
	state: TaskState,
	maxWidth = 80,
): string[] | undefined {
	const active = state.activeTaskId
		? state.tasks[state.activeTaskId]
		: undefined;
	if (!active) return undefined;
	const gaps = getVerificationGaps(active);
	const lines = [
		`Active task: ${active.id} ${active.title}`,
		`Progress: ${active.progress}% | ${active.status} | Next: ${active.nextAction ?? "unset"}`,
		`Criteria: ${countCriteria(active, "satisfied")}/${active.acceptanceCriteria.length} satisfied | Evidence: ${active.evidence.length}`,
	];
	if (active.blockers.some((blocker) => !blocker.resolvedAt)) {
		lines.push(
			`Blocked: ${active.blockers.find((blocker) => !blocker.resolvedAt)?.reason ?? "unresolved blocker"}`,
		);
	}
	if (gaps.length > 0) lines.push(`Gaps: ${gaps.join("; ")}`);
	return lines.slice(0, 5).map((line) => truncateText(line, maxWidth));
}

export function formatTaskList(
	state: TaskState,
	options: {
		includeDone?: boolean;
		includeEvidence?: boolean;
		limit?: number;
	} = {},
): string {
	const tasks = sortTasks(
		Object.values(state.tasks),
		state.activeTaskId,
	).filter((task) => options.includeDone || task.status !== "done");
	const limited = tasks.slice(0, options.limit ?? 20);
	if (limited.length === 0) return "No tasks on this branch.";
	const lines = limited.flatMap((task) => {
		const unresolvedBlockerCount = task.blockers.filter(
			(blocker) => !blocker.resolvedAt,
		).length;
		const criteria = `${countCriteria(task, "satisfied")}/${task.acceptanceCriteria.length}`;
		const evidence = options.includeEvidence
			? ` evidence:${task.evidence.length}`
			: "";
		const blockerText =
			unresolvedBlockerCount > 0 ? ` blockers:${unresolvedBlockerCount}` : "";
		const summary = `${task.id} [${task.status}] ${task.progress}% criteria:${criteria}${evidence}${blockerText} - ${task.title}`;
		if (!options.includeEvidence) return [summary];
		const blockerLines = task.blockers.map(
			(blocker) =>
				`  - blocker ${blocker.id} [${blocker.resolvedAt ? "resolved" : blocker.blockedBy}] ${compactDetail(blocker.reason)}; unblock: ${compactDetail(blocker.neededToUnblock)}`,
		);
		const planSteps = (task.planSteps ?? []).map(
			(step) =>
				`  - ${step.id} step [${step.status}/${step.decompositionStatus}] ${compactDetail(step.text)}; output: ${compactDetail(step.expectedOutput)}${step.parentStepId ? `; parent:${step.parentStepId}` : ""}; atomic:${step.granularityCheck.isAtomic}; planQuality:${step.planQuality.score}${step.planQuality.issues.length ? ` (${compactDetail(step.planQuality.issues.join("; "))})` : ""}${step.evidenceRequired ? "; evidence required" : ""}${step.criterionIds.length ? `; criteria:${step.criterionIds.join(",")}` : ""}${step.evidenceIds.length ? `; evidence:${step.evidenceIds.join(",")}` : ""}`,
		);
		const decisions = task.decisions.map(
			(decision) =>
				`  - ${decision.id} decision [${decision.decidedBy}] ${compactDetail(decision.question)}: ${compactDetail(decision.decision)}${decision.rationale ? `; rationale: ${compactDetail(decision.rationale)}` : ""}`,
		);
		return [
			summary,
			...task.warnings.map((warning) => `  - warning ${warning}`),
			...blockerLines,
			...decisions,
			...planSteps,
			...task.acceptanceCriteria.map(
				(criterion) =>
					`  - ${criterion.id} [${criterion.status}] ${compactDetail(criterion.text)}${criterion.evidenceIds.length ? ` evidence:${criterion.evidenceIds.join(",")}` : ""}`,
			),
			...task.evidence.map(
				(item) =>
					`  - ${item.id} evidence ${item.level} ${item.passed}: ${compactDetail(item.summary)}; source:${compactRef(item.quality.source)}; reproducible:${item.quality.reproducible}; role:${item.role ?? "acceptance"}${formatEvidenceSupersession(task, item)}${item.references.length ? ` (${item.references.map(compactRef).join(", ")})` : ""}`,
			),
		];
	});
	const warnings =
		state.warnings.length > 0
			? ["", "Warnings:", ...state.warnings.map((warning) => `- ${warning}`)]
			: [];
	return [...lines, ...warnings].join("\n");
}

function formatEvidenceSupersession(
	task: Task,
	evidence: Task["evidence"][number],
): string {
	const supersedes = evidence.supersedesEvidenceIds ?? [];
	const supersededBy = task.evidence
		.filter((item) => (item.supersedesEvidenceIds ?? []).includes(evidence.id))
		.map((item) => item.id);
	return `${supersedes.length ? `; supersedes:${supersedes.join(",")}` : ""}${evidence.supersessionReason ? `; reason:${compactDetail(evidence.supersessionReason)}` : ""}${supersededBy.length ? `; superseded by:${supersededBy.join(",")}` : ""}`;
}

function compactDetail(text: string): string {
	return truncateText(text.replace(/\s+/g, " ").trim(), DETAIL_TEXT_MAX);
}

function compactRef(text: string): string {
	return truncateText(text.replace(/\s+/g, " ").trim(), DETAIL_REF_MAX);
}

export function formatTaskFocus(state: TaskState): string {
	const task = state.activeTaskId ? state.tasks[state.activeTaskId] : undefined;
	if (!task) return buildTaskResume(state).resumeInstruction;
	const step = (task.planSteps ?? []).find(
		(item) => item.status !== "done" && item.status !== "skipped",
	);
	const lines = [
		`Active task: ${task.id} ${compactDetail(task.title)}`,
		`Status: ${task.status} ${task.progress}%`,
	];
	if (step) {
		lines.push(
			`Current step: ${step.id} [${step.status}] ${compactDetail(step.text)}`,
		);
		lines.push(`Granularity: ${step.decompositionStatus}`);
		lines.push(
			`Atomicity reason: ${compactDetail(step.granularityCheck.reason)}`,
		);
		lines.push(
			`Plan quality: ${step.planQuality.score}${step.planQuality.issues.length ? ` (${compactDetail(step.planQuality.issues.join("; "))})` : ""}`,
		);
		if (step.parentStepId) lines.push(`Parent step: ${step.parentStepId}`);
		lines.push(`Expected output: ${compactDetail(step.expectedOutput)}`);
		lines.push(
			`Evidence: ${step.evidenceIds.length ? step.evidenceIds.join(",") : "none"}${step.evidenceRequired ? " (required)" : ""}`,
		);
		if (step.criterionIds.length > 0) {
			lines.push(`Linked criteria: ${step.criterionIds.join(",")}`);
		}
		if (step.allowedActions.length > 0) {
			lines.push(
				`Allowed actions: ${step.allowedActions.map(compactRef).join(", ")}`,
			);
		}
	} else {
		lines.push("Current step: none open");
	}
	const resume = buildTaskResume(state);
	lines.push(`Recommended tool: ${resume.recommendedTool}`);
	lines.push(`Next allowed actions: ${resume.nextAllowedActions.join(", ")}`);
	lines.push(
		"Review findings: use task_rework for in-scope remediation; do not force-complete known gaps.",
	);
	const gaps = getVerificationGaps(task);
	if (gaps.length > 0) lines.push(`Gaps: ${gaps.join("; ")}`);
	if (task.warnings.length > 0) {
		lines.push("Warnings:");
		lines.push(
			...task.warnings.map((warning) => `- ${compactDetail(warning)}`),
		);
	}
	return lines.join("\n");
}

export function buildTaskResume(state: TaskState): TaskResumeContext {
	const task = state.activeTaskId ? state.tasks[state.activeTaskId] : undefined;
	if (!task) {
		const hasTasks = Object.keys(state.tasks).length > 0;
		return {
			mode: "planning",
			recommendedTool: "task_plan",
			blockedTools: ["task_update", "task_evidence", "task_complete"],
			minimumParams: getTaskPlanRecoveryParams(),
			currentStepLineage: [],
			evidenceIds: [],
			criterionIds: [],
			allowedActions: [],
			nextAllowedActions: withSupportActions(
				hasTasks
					? ["task_plan", "task_list", "task_rework", "task_decision"]
					: ["task_plan"],
			),
			verificationGaps: [],
			blockers: [],
			decisions: [],
			warnings: [...state.warnings],
			resumeInstruction: hasTasks
				? "No active pi-tasks task. Use task_list to find an existing task, then task_rework with findings and remediation steps when review discovers gaps (including done tasks). Create a new objective with task_plan only when needed."
				: "No active pi-tasks task. Create one with task_plan before implementation work.",
		};
	}
	const step = getCurrentOpenStep(task);
	const gaps = getVerificationGaps(task);
	const blockers = task.blockers
		.filter((blocker) => !blocker.resolvedAt)
		.map((blocker) => `${blocker.id}: ${compactDetail(blocker.reason)}`);
	const decisions = task.decisions
		.slice(-3)
		.map(
			(decision) =>
				`${decision.id}: ${compactDetail(decision.question)} -> ${compactDetail(decision.decision)}`,
		);
	const mode = getExecutionMode(task, step, blockers.length > 0, gaps);
	const recommendedTool = getRecommendedTool(mode, step);
	const nextAllowedActions = withSupportActions([
		recommendedTool,
		...(step ? getNextAllowedActions(step, mode === "blocked") : []),
		"task_rework",
		"task_decision",
	]);
	return {
		...(state.activeTaskId ? { activeTaskId: state.activeTaskId } : {}),
		taskId: task.id,
		title: compactDetail(task.title),
		status: task.status,
		progress: task.progress,
		mode,
		recommendedTool,
		blockedTools: getBlockedTools(mode),
		minimumParams: getMinimumParams(task, step, recommendedTool),
		...(step
			? {
					currentStepId: step.id,
					currentStepText: compactDetail(step.text),
					currentStepLineage: getStepLineage(task, step),
					expectedOutput: compactDetail(step.expectedOutput),
					evidenceRequired: step.evidenceRequired,
					evidenceIds: [...step.evidenceIds],
					criterionIds: [...step.criterionIds],
					allowedActions: step.allowedActions.map(compactRef),
				}
			: {
					currentStepLineage: [],
					evidenceIds: [],
					criterionIds: [],
					allowedActions: [],
				}),
		nextAllowedActions,
		verificationGaps: gaps,
		blockers,
		decisions,
		warnings: [...state.warnings, ...task.warnings].map(compactDetail),
		resumeInstruction: buildResumeInstruction(
			task,
			step,
			gaps,
			nextAllowedActions,
		),
	};
}

export function formatTaskResume(state: TaskState): string {
	const resume = buildTaskResume(state);
	const lines = ["pi-tasks resume"];
	if (!resume.taskId) {
		lines.push(`Instruction: ${resume.resumeInstruction}`);
		return lines.join("\n");
	}
	lines.push(
		`Task: ${resume.taskId} [${resume.status}] ${resume.progress}% - ${resume.title}`,
	);
	if (resume.mode) lines.push(`Mode: ${resume.mode}`);
	if (resume.recommendedTool) {
		lines.push(`Do now: ${resume.recommendedTool}`);
	}
	if (resume.blockedTools && resume.blockedTools.length > 0) {
		lines.push(`Do not call: ${resume.blockedTools.join(", ")}`);
	}
	if (resume.currentStepId) {
		lines.push(
			`Current step: ${resume.currentStepId} ${resume.currentStepText ?? ""}`,
		);
		if (resume.currentStepLineage.length > 0) {
			lines.push(
				`Lineage: ${resume.currentStepLineage.map((step) => `${step.id}:${step.decompositionStatus}`).join(" > ")}`,
			);
		}
		if (resume.expectedOutput) {
			lines.push(`Expected output: ${resume.expectedOutput}`);
		}
		lines.push(
			`Evidence: ${resume.evidenceIds.length ? resume.evidenceIds.join(",") : "none"}${resume.evidenceRequired ? " (required)" : ""}`,
		);
		if (resume.criterionIds.length > 0) {
			lines.push(`Linked criteria: ${resume.criterionIds.join(",")}`);
		}
		if (resume.allowedActions.length > 0) {
			lines.push(`Allowed actions: ${resume.allowedActions.join(", ")}`);
		}
	} else {
		lines.push("Current step: none open");
	}
	if (resume.minimumParams) {
		lines.push(`Minimum params: ${formatMinimumParams(resume.minimumParams)}`);
	}
	lines.push(`Next allowed actions: ${resume.nextAllowedActions.join(", ")}`);
	if (resume.verificationGaps.length > 0) {
		lines.push(`Cannot complete yet: ${resume.verificationGaps.join("; ")}`);
	}
	if (resume.blockers.length > 0) {
		lines.push(`Blockers: ${resume.blockers.join("; ")}`);
	}
	if (resume.decisions.length > 0) {
		lines.push(`Recent decisions: ${resume.decisions.join("; ")}`);
	}
	if (resume.warnings.length > 0) {
		lines.push(`Warnings: ${resume.warnings.join("; ")}`);
	}
	lines.push(`Instruction: ${resume.resumeInstruction}`);
	return lines.join("\n");
}

export function formatTaskNext(state: TaskState): string {
	const resume = buildTaskResume(state);
	const lines = ["pi-tasks next"];
	if (!resume.taskId) {
		lines.push("Mode: planning");
		lines.push("Do now: task_plan");
		lines.push("Do not call: task_update, task_evidence, task_complete");
		lines.push(`Always allowed: ${SUPPORT_ACTIONS.join(", ")}`);
		lines.push(
			`Minimum params: ${formatMinimumParams(resume.minimumParams ?? {})}`,
		);
		lines.push(`Stop condition: ${resume.resumeInstruction}`);
		return lines.join("\n");
	}
	lines.push(`Task: ${resume.taskId} - ${resume.title}`);
	lines.push(`Mode: ${resume.mode ?? "executing"}`);
	lines.push(
		`Recommended tool: ${resume.recommendedTool ?? resume.nextAllowedActions[0] ?? "task_resume"}`,
	);
	lines.push(`Always allowed: ${SUPPORT_ACTIONS.join(", ")}`);
	if (resume.currentStepId) {
		lines.push(`Current step lock: ${resume.currentStepId}`);
	}
	if (resume.minimumParams) {
		lines.push(`Minimum params: ${formatMinimumParams(resume.minimumParams)}`);
	}
	if (resume.blockedTools && resume.blockedTools.length > 0) {
		lines.push(`Do not call: ${resume.blockedTools.join(", ")}`);
	}
	lines.push(`Next allowed actions: ${resume.nextAllowedActions.join(", ")}`);
	lines.push(
		"Review findings: task_rework is the explicit remediation path, even when completion is recommended.",
	);
	lines.push(`Stop condition: ${resume.resumeInstruction}`);
	if (resume.verificationGaps.length > 0) {
		lines.push(`Gaps: ${resume.verificationGaps.join("; ")}`);
	}
	return lines.join("\n");
}

export function getVerificationGaps(task: Task): string[] {
	const gaps: string[] = [];
	const incompleteStep = (task.planSteps ?? []).find(
		(step) => step.status !== "done" && step.status !== "skipped",
	);
	if (incompleteStep) gaps.push(`${incompleteStep.id} step pending`);
	for (const step of task.planSteps ?? []) {
		if (
			step.status !== "done" &&
			step.status !== "skipped" &&
			step.decompositionStatus !== "atomic"
		) {
			gaps.push(`${step.id} needs breakdown`);
		}
	}
	for (const step of task.planSteps ?? []) {
		if (
			step.evidenceRequired &&
			(step.status === "done" || step.status === "skipped") &&
			step.evidenceIds.length === 0
		) {
			gaps.push(`${step.id} lacks evidence`);
		}
	}
	for (const criterion of task.acceptanceCriteria) {
		if (criterion.status !== "satisfied" && criterion.status !== "skipped")
			gaps.push(`${criterion.id} pending`);
		if (
			criterion.status === "satisfied" &&
			(!hasActiveAcceptanceEvidence(task, criterion.evidenceIds) ||
				!hasFreshCriterionEvidence(task, criterion))
		) {
			gaps.push(`${criterion.id} lacks acceptance evidence`);
		}
	}
	const activeAcceptanceEvidence = task.evidence.filter((evidence) =>
		hasActiveAcceptanceEvidence(task, [evidence.id]),
	);
	if (activeAcceptanceEvidence.length === 0)
		gaps.push("no acceptance evidence");
	if (
		activeAcceptanceEvidence.length > 0 &&
		activeAcceptanceEvidence.every(
			(evidence) => evidence.level === "not_verified",
		)
	) {
		gaps.push("only not_verified acceptance evidence");
	}
	return gaps;
}

function hasActiveAcceptanceEvidence(
	task: Task,
	evidenceIds: string[],
): boolean {
	return evidenceIds.some((evidenceId) => {
		const evidence = task.evidence.find((item) => item.id === evidenceId);
		if (!evidence || (evidence.role ?? "acceptance") !== "acceptance") {
			return false;
		}
		return !task.evidence.some(
			(replacement) =>
				(replacement.role ?? "acceptance") === "acceptance" &&
				replacement.passed === true &&
				Boolean(replacement.supersessionReason?.trim()) &&
				(replacement.supersedesEvidenceIds ?? []).includes(evidenceId),
		);
	});
}

function getCurrentOpenStep(task: Task): TaskStep | undefined {
	return task.planSteps.find(
		(step) => step.status !== "done" && step.status !== "skipped",
	);
}

function withSupportActions(actions: string[]): string[] {
	return unique([...actions, ...SUPPORT_ACTIONS]);
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function getNextAllowedActions(step: TaskStep, hasBlockers: boolean): string[] {
	// Support actions (safe local reads, searches, instruction/tool discovery)
	// never mutate repo or task state, so they are always admissible
	// regardless of decomposition status or blockers - an agent must never
	// need to decompose a step just to unlock a safe read.
	if (hasBlockers) return withSupportActions(["task_update"]);
	if (step.decompositionStatus !== "atomic") {
		return withSupportActions([
			"task_decompose",
			"task_decision",
			"task_update",
		]);
	}
	if (step.evidenceRequired && step.evidenceIds.length === 0) {
		return withSupportActions(
			[...step.allowedActions, "task_verify_step", "task_evidence"].filter(
				Boolean,
			),
		);
	}
	return withSupportActions(
		["task_update", "task_evidence", ...step.allowedActions].filter(Boolean),
	);
}

function getExecutionMode(
	task: Task,
	step: TaskStep | undefined,
	hasBlockers: boolean,
	gaps: string[],
): TaskExecutionMode {
	if (hasBlockers || task.status === "blocked") return "blocked";
	if (!step) return gaps.length > 0 ? "verifying" : "completing";
	if (step.decompositionStatus !== "atomic") return "decomposing";
	if (step.evidenceRequired && step.evidenceIds.length === 0)
		return "verifying";
	return "executing";
}

function getRecommendedTool(
	mode: TaskExecutionMode,
	step: TaskStep | undefined,
): string {
	if (mode === "planning") return "task_plan";
	if (mode === "blocked") return "task_update";
	if (mode === "decomposing") return "task_decompose";
	if (mode === "verifying") return step ? "task_verify_step" : "task_evidence";
	if (mode === "completing") return "task_complete";
	return step?.allowedActions[0] ?? "task_update";
}

function getBlockedTools(mode: TaskExecutionMode): string[] {
	const blocked = getBlockedToolsForMode(mode);
	// Support actions must never be blocked, no matter the mode - they are
	// always-admissible reads/searches/discovery, not mutating task tools.
	return blocked.filter((tool) => !isSupportAction(tool));
}

function getBlockedToolsForMode(mode: TaskExecutionMode): string[] {
	if (mode === "planning")
		return ["task_update", "task_evidence", "task_complete"];
	if (mode === "blocked") return ["task_complete", "task_decompose"];
	if (mode === "decomposing") return ["task_update done", "task_complete"];
	if (mode === "verifying") return ["task_update done", "task_complete"];
	if (mode === "completing") return ["task_plan", "task_decompose"];
	return ["task_complete"];
}

function getMinimumParams(
	task: Task,
	step: TaskStep | undefined,
	recommendedTool: string,
): Record<string, unknown> {
	if (recommendedTool === "task_decompose" && step) {
		return {
			task_id: task.id,
			step_id: step.id,
			child_steps: ["<2+ atomic child steps>"],
		};
	}
	if (recommendedTool === "task_evidence") {
		return {
			task_id: task.id,
			step_ids: step ? [step.id] : [],
			criterion_ids:
				step?.criterionIds ??
				task.acceptanceCriteria
					.filter(
						(criterion) =>
							criterion.status !== "satisfied" &&
							criterion.status !== "skipped",
					)
					.map((criterion) => criterion.id),
			references: ["<artifact path or command>"],
		};
	}
	if (recommendedTool === "task_verify_step" && step) {
		return {
			task_id: task.id,
			step_id: step.id,
			criterion_ids: step.criterionIds,
			references: ["<artifact path or command>"],
		};
	}
	if (
		recommendedTool === "task_update" &&
		(task.status === "blocked" ||
			task.blockers.some((blocker) => !blocker.resolvedAt))
	) {
		return {
			task_id: task.id,
			status: "active",
			reason: "<how the blocker was resolved>",
		};
	}
	if (recommendedTool === "task_update" && step) {
		return {
			task_id: task.id,
			step_id: step.id,
			step_status: "done",
			step_evidence_ids: ["<evidence id>"],
		};
	}
	if (recommendedTool === "task_complete") {
		return {
			task_id: task.id,
			evidence_ids: task.evidence.map((evidence) => evidence.id),
		};
	}
	return { task_id: task.id };
}

/**
 * Build a copyable, schema-valid scaffold for the no-active-task recovery
 * branch. The previous shape `{ plan_steps: ["<atomic step contract>"] }` was
 * not accepted by the task_plan schema (plan_steps is `TaskStepInput[]`, not
 * `string[]`) and could not be resubmitted as-is, so the recovery was useless.
 *
 * The scaffold below passes the reducer's quality gate and granularity
 * contract so an agent can copy it verbatim, edit the placeholders, and
 * resubmit. It deliberately:
 *   - uses `decompositionStatus: "needs_breakdown"` to avoid the
 *     atomic-only criterion link requirement (criterionIds are
 *     server-generated, never guessed by the scaffold);
 *   - includes `activate: true` so a successful submit immediately becomes
 *     the active task;
 *   - includes a complete granularityCheck with `isAtomic: false` so the
 *     schema is satisfied and the agent replaces it with a verified atomic
 *     contract during task planning (typically via task_decompose).
 */
function getTaskPlanRecoveryParams(): Record<string, unknown> {
	return {
		title: "<short task title>",
		objective: "<bounded objective>",
		acceptance_criteria: ["<verifiable criterion>"],
		plan_steps: [
			{
				text: "Replace with the bounded step text (>= 8 chars, no vague wording)",
				expectedOutput:
					"Replace with the verifiable single observable output (>= 12 chars)",
				allowedActions: ["task_decompose"],
				evidenceRequired: true,
				decompositionStatus: "needs_breakdown",
				granularityCheck: {
					isAtomic: false,
					reason:
						"Scaffold from task_plan rejection; refine with task_decompose before claiming atomicity.",
					canBeDoneInOneAgentAction: false,
					hasSingleObservableOutput: false,
					hasSingleVerificationMethod: false,
					hasNoHiddenSubtasks: false,
				},
			},
		],
		activate: true,
	};
}

function formatMinimumParams(params: Record<string, unknown>): string {
	return JSON.stringify(params);
}

function getStepLineage(task: Task, step: TaskStep): TaskResumeStep[] {
	const lineage: TaskResumeStep[] = [];
	let current: TaskStep | undefined = step;
	while (current) {
		lineage.unshift({
			id: current.id,
			text: compactDetail(current.text),
			status: current.status,
			decompositionStatus: current.decompositionStatus,
		});
		if (!current.parentStepId) break;
		const parent = task.planSteps.find(
			(candidate) => candidate.id === current?.parentStepId,
		);
		if (!parent) {
			lineage.unshift({
				id: current.parentStepId,
				text: "decomposed parent step",
				status: "done",
				decompositionStatus: "breaking_down",
			});
			break;
		}
		current = parent;
	}
	return lineage;
}

function buildResumeInstruction(
	task: Task,
	step: TaskStep | undefined,
	gaps: string[],
	nextAllowedActions: string[],
): string {
	if (task.status === "blocked") {
		return "Resolve the blocker with task_update before continuing execution. task_rework can record remediation but does not resolve blockers.";
	}
	if (!step) {
		return gaps.length > 0
			? "No open step remains, but verification gaps remain. Use task_evidence for verification or task_rework with findings and remediation steps for missing implementation. Do not force-complete known gaps."
			: "No open step remains. Use task_complete only if implementation is verified; if review finds gaps, use task_rework with findings and remediation steps without requesting permission for in-scope repairs.";
	}
	if (step.decompositionStatus !== "atomic") {
		return `Resume by decomposing ${step.id}; do not execute or mark it done until it is atomic.`;
	}
	if (step.evidenceRequired && step.evidenceIds.length === 0) {
		return `Resume ${step.id} by performing one allowed action, then use task_verify_step to record passing evidence and advance atomically.`;
	}
	return `Resume ${step.id} with ${nextAllowedActions.join(" or ")}; keep ordered step progression.`;
}

function countCriteria(
	task: Task,
	status: Task["acceptanceCriteria"][number]["status"],
): number {
	return task.acceptanceCriteria.filter(
		(criterion) => criterion.status === status,
	).length;
}

function sortTasks(tasks: Task[], activeTaskId?: string): Task[] {
	return [...tasks].sort((a, b) => {
		if (a.id === activeTaskId) return -1;
		if (b.id === activeTaskId) return 1;
		const statusDelta =
			STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
		if (statusDelta !== 0) return statusDelta;
		return a.createdAt.localeCompare(b.createdAt);
	});
}
