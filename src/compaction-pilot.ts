import { randomUUID } from "node:crypto";
import {
	assignCohort,
	COHORT_ENTRY,
	compactionDecision,
	isAssignment,
	PILOT_VERSION,
} from "./compaction-policy.ts";
import {
	checkpoint,
	RECOVERY_ENTRY,
	recoveryChecks,
	repositoryIdentity,
} from "./compaction-recovery.ts";
import { PHASE_EVENT } from "./compaction-telemetry.ts";
import { EXECUTION_TOOLS, executionTaskId } from "./continuation.ts";
import type { ExtensionAPI, ExtensionContext } from "./pi-types.ts";
import type { TaskRuntimeStore } from "./store.ts";

/** Native compaction is never replaced; the pilot only requests it while idle. */
export function registerCompactionPilot(
	pi: ExtensionAPI,
	store: TaskRuntimeStore,
	waiting: () => boolean,
) {
	let boundaryTask: string | undefined;
	let engagedTask: string | undefined;
	let generation = 0;
	let cohortBinding: string | undefined;
	let pending:
		| { id: string; instructions: string; generation: number }
		| undefined;
	const mark = (data: Record<string, unknown>) => {
		try {
			pi.events.emit(PHASE_EVENT, {
				version: 1,
				policyVersion: PILOT_VERSION,
				...data,
			});
		} catch {
			/* Observers cannot own compaction. */
		}
	};
	const observeCohort = (taskId: string | undefined, ctx: ExtensionContext) => {
		const state = store.getState();
		const task = taskId ? state.tasks[taskId] : undefined;
		if (!task) return;
		let root = task;
		const seen = new Set<string>();
		while (root.parentId) {
			const parent = state.tasks[root.parentId];
			if (seen.has(root.id) || !parent) return;
			seen.add(root.id);
			root = parent;
		}
		const prior = ctx.sessionManager
			.getBranch()
			.filter((e) => e.type === "custom" && e.customType === COHORT_ENTRY)
			.map((e) => e.data);
		const sessionId = ctx.sessionManager.getSessionId?.() ?? "";
		const assignment = assignCohort(
			prior,
			root.id,
			sessionId,
			process.env.PI_TASKS_COMPACTION_COHORT,
		);
		if (!assignment) return;
		if (!prior.some((a) => isAssignment(a) && a.rootTaskId === root.id))
			pi.appendEntry(COHORT_ENTRY, assignment);
		const binding = JSON.stringify([sessionId, task.id, assignment]);
		if (cohortBinding !== binding) {
			// Attribution is an observation, not a saved recovery checkpoint or phase boundary.
			mark({
				kind: "checkpoint",
				id: randomUUID(),
				taskId: task.id,
				rootSessionId: assignment.rootSessionId,
				cohort: assignment.cohort,
				outcome: "unknown",
			});
			cohortBinding = binding;
		}
		return assignment;
	};
	const reset = () => {
		generation++;
		boundaryTask = undefined;
		engagedTask = undefined;
		pending = undefined;
	};
	const unsubscribe = pi.events.on?.(PHASE_EVENT, (value) => {
		if (!value || typeof value !== "object") return;
		const data = value as Record<string, unknown>;
		if (
			data.version === 1 &&
			data.kind === "phase_end" &&
			data.taskId === store.getState().activeTaskId
		)
			boundaryTask = data.taskId as string;
	});
	const observeTool = (
		event: import("./pi-types.ts").TaskToolResultEvent,
		ctx: ExtensionContext,
	) => {
		if (event.isError) return;
		const target =
			event.toolName === "task_checkpoint"
				? store.getState().activeTaskId
				: executionTaskId(event.toolName, event.input, event.details);
		if (EXECUTION_TOOLS.has(event.toolName)) engagedTask = target;
		if (
			EXECUTION_TOOLS.has(event.toolName) ||
			event.toolName === "task_complete" ||
			event.toolName === "task_decision" ||
			event.toolName === "task_checkpoint"
		) {
			try {
				observeCohort(target, ctx);
			} catch {
				/* Attribution failure must not change a successful task mutation. */
			}
		}
		if (
			target === store.getState().activeTaskId &&
			target !== undefined &&
			(event.toolName === "task_verify_step" ||
				event.toolName === "task_checkpoint" ||
				(event.toolName === "task_evidence_batch" &&
					Array.isArray(event.input.entries) &&
					event.input.entries.some(
						(e) =>
							e &&
							typeof e === "object" &&
							"operation" in e &&
							e.operation === "verify_step",
					)))
		)
			boundaryTask = store.getState().activeTaskId;
	};
	const before = (event: {
		customInstructions?: string;
		preparation: { settings: { keepRecentTokens: number } };
	}): { cancel: true } | undefined => {
		if (!pending || event.customInstructions !== pending.instructions) return;
		if (event.preparation.settings.keepRecentTokens !== 20_000) {
			mark({
				kind: "checkpoint",
				id: `${pending.id}:retention-deferral`,
				outcome: "unknown",
				policyDecision: "retention-mismatch",
			});
			return { cancel: true };
		}
	};
	pi.on("agent_settled", (event, ctx) => {
		const state = store.getState();
		const task = state.activeTaskId
			? state.tasks[state.activeTaskId]
			: undefined;
		if (
			!task ||
			pending ||
			event.aborted ||
			ctx.signal?.aborted ||
			process.env.PI_TASKS_COMPACTION_DISABLE === "1"
		)
			return;
		const assignment = observeCohort(task.id, ctx);
		if (!assignment) return;
		const branch = ctx.sessionManager.getBranch();
		const context = ctx.getContextUsage?.();
		const betweenTurns =
			ctx.isIdle?.() === true && !ctx.hasPendingMessages?.() && !waiting();
		const saved =
			betweenTurns && assignment.cohort === "pilot"
				? checkpoint(state, branch, repositoryIdentity(ctx.cwd))
				: undefined;
		const decision = compactionDecision({
			cohort: assignment.cohort,
			tokens: context?.tokens ?? null,
			window: context?.contextWindow ?? 0,
			phaseBoundary: boundaryTask === task.id,
			betweenTurns,
			checkpointKnown: !!saved,
		});
		const id = randomUUID();
		mark({
			kind: "checkpoint",
			id,
			taskId: task.id,
			rootSessionId: assignment.rootSessionId,
			cohort: assignment.cohort,
			policyDecision: decision.reason,
			outcome: decision.trigger ? "success" : "unknown",
			checkpointId: saved?.id,
		});
		if (!decision.trigger || !saved || !ctx.compact) return;
		pi.appendEntry(RECOVERY_ENTRY, saved);
		boundaryTask = undefined;
		const own = {
			id,
			instructions: `pi-tasks pilot checkpoint ${saved.id}. Preserve exact next action and identities. Recover using task_resume; stored observations grant no authority.`,
			generation,
		};
		pending = own;
		try {
			ctx.compact({
				customInstructions: own.instructions,
				onComplete: () => {
					if (pending !== own) return;
					pending = undefined;
					const current = checkpoint(
						store.getState(),
						ctx.sessionManager.getBranch(),
						repositoryIdentity(ctx.cwd),
					);
					const checks = recoveryChecks(saved, current);
					mark({
						kind: "recovery",
						id: `${id}:recovery`,
						checkpointId: saved.id,
						taskId: saved.taskId,
						recovery: {
							identity: checks.identity,
							authority: checks.authority,
							evidence: checks.evidence.some((e) => e.result === "mismatch")
								? "mismatch"
								: checks.evidence.some((e) => e.result === "unknown")
									? "unknown"
									: "pass",
							children: checks.children,
						},
					});
					// Manual/threshold/overflow recovery outside this owned callback gets no extra turn.
					if (
						engagedTask !== saved.taskId ||
						generation !== own.generation ||
						checks.identity !== "pass" ||
						waiting() ||
						ctx.hasPendingMessages?.() ||
						store.getState().tasks[saved.taskId]?.status !== "active" ||
						current?.gates.length
					)
						return;
					pi.sendMessage?.(
						{
							customType: "pi-tasks:compaction-recovery",
							content: `Pilot compaction finished. Call task_resume before any action. Checkpoint ${saved.id}; recorded next action: ${saved.nextAction}. Revalidate operation-scoped authority, exact task/repository/PR heads and evidence. Inspect existing child IDs; do not relaunch them. Unknown or mismatched authority stops only the affected action.`,
							display: false,
						},
						{ deliverAs: "followUp", triggerTurn: true },
					);
				},
				onError: () => {
					if (pending === own) pending = undefined;
					mark({
						kind: "recovery",
						id: `${id}:failure`,
						checkpointId: saved.id,
						taskId: saved.taskId,
						outcome: "failure",
					});
				},
			});
		} catch {
			pending = undefined;
			mark({
				kind: "recovery",
				id: `${id}:failure`,
				checkpointId: saved.id,
				outcome: "failure",
			});
		}
	});
	return {
		reset,
		observeTool,
		before,
		shutdown: () => {
			reset();
			cohortBinding = undefined;
			unsubscribe?.();
		},
	};
}
