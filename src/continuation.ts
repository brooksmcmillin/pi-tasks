import type { TaskState } from "./model.ts";
import { buildTaskResume } from "./render.ts";

const EXECUTION_TOOLS = new Set([
	"task_plan",
	"task_decompose",
	"task_rework",
	"task_replan",
	"task_update",
	"task_evidence",
	"task_evidence_batch",
	"task_verify_step",
]);

/** One advisory per input, not an automatic task-completion loop. */
export function createContinuationAdvisory() {
	let taskId: string | undefined;
	let sent = false;
	return {
		relinquish() {
			sent = true;
		},
		reset() {
			taskId = undefined;
			sent = false;
		},
		observeToolResult(
			name: string,
			isError: boolean,
			input: Record<string, unknown>,
			details?: unknown,
		) {
			if (isError || !EXECUTION_TOOLS.has(name)) return;
			if (name === "task_plan") {
				// Inactive creation returns the old active task's resume contract.
				taskId =
					input.activate !== false &&
					details &&
					typeof details === "object" &&
					"taskId" in details &&
					typeof details.taskId === "string"
						? details.taskId
						: undefined;
			} else {
				taskId = typeof input.task_id === "string" ? input.task_id : undefined;
			}
		},
		take(state: TaskState): string | undefined {
			if (sent || !taskId || state.activeTaskId !== taskId) return;
			const resume = buildTaskResume(state);
			if (
				resume.status !== "active" ||
				resume.blockers.length > 0 ||
				!resume.currentStepId ||
				!resume.recommendedTool ||
				!resume.nextAllowedActions.includes(resume.recommendedTool) ||
				resume.blockedTools?.includes(resume.recommendedTool)
			)
				return;
			sent = true;
			return [
				"pi-tasks yield check (advisory, once per input)",
				`Task ${resume.taskId} still has an open step: ${resume.currentStepId} ${resume.currentStepText}. No unresolved blocker is recorded.`,
				"Check whether ending now matches the user's current request. If this work is still authorized and actionable, continue using the resume guidance below rather than only describing the remaining checklist.",
				"A prerequisite not yet performed (such as review or validation) is a next action, not by itself a blocker. Do not bypass that prerequisite.",
				"Respect a user stop, redirection, explanation-only request, required human decision or authority boundary. If genuinely blocked, record the specific obstacle and what is needed to proceed; cite a failed operation when applicable, without inventing a failure or requiring an unsafe attempt. If awaiting asynchronous work, wait for its notification rather than polling or launching duplicate work.",
				"This is not a completion gate: do not invent scope, force-complete the task, or create a PR unless requested.",
				`Recommended tool: ${resume.recommendedTool}`,
				`Minimum params: ${JSON.stringify(resume.minimumParams)}`,
				`Instruction: ${resume.resumeInstruction}`,
			].join("\n");
		},
	};
}
