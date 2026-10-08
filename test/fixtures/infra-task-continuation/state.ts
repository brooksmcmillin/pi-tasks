import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

export const STATE_TYPE = "task-continuation:state";
export const OWNERSHIP_EVENT = "task-continuation:ownership";
export type Disposition =
	| "proceed"
	| "blocker"
	| "decision"
	| "wait"
	| "complete"
	| "stop";
export type BlockedBy = "external" | "dependency" | "authority" | "ownership";
export interface PickupState {
	version: 1;
	taskId?: string;
	disposition: Disposition;
	nextAction: string;
	reason: string;
	blockedBy?: BlockedBy;
	nudged: boolean;
	diagnosed: boolean;
	progress: number;
	nudgeProgress: number;
	pendingAsync: string[];
	recovery?: { inputId: string; owned: boolean };
}

function withRecovery(state: PickupState): PickupState {
	const recovery = state.recovery ?? { inputId: randomUUID(), owned: false };
	return {
		...state,
		recovery: {
			...recovery,
			owned:
				recovery.owned ||
				!!state.taskId ||
				state.nudged ||
				state.pendingAsync.length > 0,
		},
	};
}
export const emptyState = (): PickupState => ({
	version: 1,
	disposition: "stop",
	nextAction: "",
	reason: "",
	nudged: false,
	diagnosed: false,
	progress: 0,
	nudgeProgress: 0,
	pendingAsync: [],
});

export function restore(
	branch: readonly { type: string; customType?: string; data?: unknown }[],
): PickupState {
	let state = emptyState();
	for (const entry of branch) {
		const data = entry.data as PickupState | undefined;
		if (
			entry.type === "custom" &&
			entry.customType === STATE_TYPE &&
			data?.version === 1 &&
			Array.isArray(data.pendingAsync)
		) {
			state = { ...data, pendingAsync: [...data.pendingAsync] };
		}
	}
	return withRecovery(state);
}

export function signal(
	state: PickupState,
	taskId: string,
	disposition: Disposition,
	nextAction = "",
	reason = "",
	blockedBy?: BlockedBy,
): PickupState {
	if (!/^[1-9][0-9]*$/.test(taskId))
		throw new Error("Use a canonical positive numeric task ID.");
	if (disposition === "proceed" && !nextAction.trim())
		throw new Error("Name the available authorized next action.");
	if (["blocker", "decision", "wait"].includes(disposition) && !reason.trim())
		throw new Error(
			"Name the specific obstacle, decision or asynchronous boundary.",
		);
	if (disposition === "blocker" && !blockedBy) {
		throw new Error(
			"Name blocked_by: external, dependency, authority or ownership. Unperformed readiness checks are next actions, not blockers.",
		);
	}
	return {
		...state,
		taskId: ["complete", "stop"].includes(disposition) ? undefined : taskId,
		disposition,
		nextAction: nextAction.trim(),
		reason: reason.trim(),
		blockedBy: disposition === "blocker" ? blockedBy : undefined,
	};
}

export function settle(
	state: PickupState,
	suppressed: boolean,
): { state: PickupState; content?: string; continue?: true } {
	if (
		suppressed ||
		!state.taskId ||
		state.disposition !== "proceed" ||
		state.pendingAsync.length
	)
		return { state };
	if (!state.nudged) {
		return {
			state: { ...state, nudged: true, nudgeProgress: state.progress },
			continue: true,
			content: `Named-task pickup ${state.taskId}: one bounded recovery nudge for this user input. Perform the unfinished authorized next step: ${state.nextAction}\nUnperformed inspection, discovery or preflight is work, not a blocker. Respect stops, redirection, actual external blockers, decisions, review gates and asynchronous waits. Do not bypass authorization or mutate TaskManager merely to satisfy this advisory. Record a specific disposition with task_pickup before yielding.`,
		};
	}
	if (state.diagnosed) return { state };
	return {
		state: { ...state, diagnosed: true },
		content: `Named-task pickup ${state.taskId} remains open${state.progress === state.nudgeProgress ? " with no recorded tool progress after recovery" : " after recovery"}. The one-nudge budget is exhausted; no further automatic turn will be injected. Last recorded next step: ${state.nextAction}. A new explicit user input may resume it; blockers and review boundaries remain authoritative.`,
	};
}

export default function register(pi: ExtensionAPI, parameters: TSchema): void {
	let state = emptyState();
	let sessionId: string | undefined;
	const publish = () =>
		pi.events.emit(OWNERSHIP_EVENT, {
			version: 1,
			owner: "named-task-pickup",
			taskId: state.taskId,
			disposition: state.disposition,
			remaining: state.nudged ? 0 : 1,
			handled: !!state.taskId,
			pendingAsync: state.pendingAsync.length > 0,
			recovery: state.recovery,
		});
	const save = () => {
		state = withRecovery(state);
		pi.appendEntry(STATE_TYPE, state);
		publish();
	};
	const replay = (_event: unknown, ctx: ExtensionContext) => {
		sessionId = ctx.sessionManager.getSessionId();
		state = restore(ctx.sessionManager.getBranch());
		publish();
	};
	pi.on("session_start", replay);
	pi.on("session_tree", replay);
	pi.on("input", (event) => {
		if (event.source === "extension") return;
		const pendingAsync = state.pendingAsync;
		state = { ...emptyState(), pendingAsync };
		save();
	});
	pi.registerTool({
		name: "task_pickup",
		label: "Named-task pickup intent",
		description:
			"Local advisory state only, never claims or changes Nexus. Register explicit /do-task intent with proceed and the available authorized nextAction before readiness. Update before yielding: blocker/decision/wait requires a specific reason; blocker also requires blocked_by (external, dependency, authority or ownership). Incomplete checks are next actions, not blockers. complete/stop clears intent. One recovery nudge per user input; repeated signals and task switches do not reset its budget.",
		parameters,
		async execute(_id, params) {
			const input = params as {
				task_id: string;
				disposition: Disposition;
				next_action?: string;
				reason?: string;
				blocked_by?: BlockedBy;
			};
			state = signal(
				state,
				input.task_id,
				input.disposition,
				input.next_action,
				input.reason,
				input.blocked_by,
			);
			save();
			return {
				content: [
					{
						type: "text",
						text: `Pickup ${input.task_id}: ${state.disposition}; ${state.reason || state.nextAction || "intent cleared"}. Recovery budget: ${state.nudged ? 0 : 1}. No TaskManager mutation.`,
					},
				],
				details: { pickup: state },
			};
		},
	});
	pi.on("tool_result", (event) => {
		if (event.isError || event.toolName === "task_pickup" || !state.taskId)
			return;
		state = { ...state, progress: state.progress + 1 };
		save();
	});
	const subscriptions = [true, false].map((started) =>
		pi.events.on(
			started ? "subagent:async-started" : "subagent:async-complete",
			(value: unknown) => {
				const data = value as
					| { sessionId?: unknown; id?: unknown; runId?: unknown }
					| undefined;
				if (!sessionId || data?.sessionId !== sessionId) return;
				const id = started ? data.id : data.runId;
				if (typeof id !== "string" || !id) return;
				const ids = new Set(state.pendingAsync);
				if (started) ids.add(id);
				else ids.delete(id);
				state = { ...state, pendingAsync: [...ids] };
				save();
			},
		),
	);
	pi.on("session_shutdown", () => {
		for (const unsubscribe of subscriptions) unsubscribe();
	});
	pi.on("agent_before_settle", (event, ctx) => {
		const result = settle(
			state,
			event.outcome !== "completed" ||
				event.continue ||
				event.context.pendingMessages.length > 0 ||
				!!ctx.signal?.aborted ||
				!!ctx.hasPendingMessages(),
		);
		if (!result.content) return;
		// Persist the spent budget in the same boundary transaction as the advisory.
		state = withRecovery(result.state);
		publish();
		return {
			entries: [
				...event.entries,
				{ type: "custom", customType: STATE_TYPE, data: state },
				{
					type: "custom_message",
					customType: result.continue
						? "task-continuation:nudge"
						: "task-continuation:stall",
					content: result.content,
					display: true,
				},
			],
			...(result.continue ? { continue: true } : {}),
		};
	});
}
