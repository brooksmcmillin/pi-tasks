import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { TaskState } from "./model.ts";
import { buildTaskResume } from "./render.ts";
import type { BranchEntry } from "./store.ts";

export const RECOVERY_ENTRY = "pi-tasks:compaction-checkpoint";
export type Verdict = "pass" | "mismatch" | "unknown";
export interface RepositoryIdentity {
	cwd: string;
	branch: string;
	head: string;
	dirtyStateReference: string;
}
export const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function repositoryIdentity(
	cwd: string | undefined,
): RepositoryIdentity | undefined {
	if (!cwd) return;
	try {
		const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			encoding: "utf8",
			timeout: 3000,
		}).trim();
		const git = (...args: string[]) =>
			execFileSync("git", args, {
				cwd: root,
				encoding: "utf8",
				maxBuffer: 8 * 1024 * 1024,
				timeout: 3000,
			});
		const branch = git("symbolic-ref", "--short", "HEAD").trim();
		const head = git("rev-parse", "HEAD").trim();
		const untracked = git("ls-files", "--others", "--exclude-standard", "-z")
			.split("\0")
			.filter(Boolean);
		if (untracked.length > 128) return;
		const files = untracked.map((path) => {
			const absolute = resolve(root, path);
			const stat = lstatSync(absolute);
			if (stat.isSymbolicLink())
				return [path, "symlink", readlinkSync(absolute)];
			if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
				throw new Error("Unknown untracked content");
			return [
				path,
				createHash("sha256").update(readFileSync(absolute)).digest("hex"),
			];
		});
		return {
			cwd: root,
			branch,
			head,
			dirtyStateReference: digest([
				git("status", "--porcelain=v1", "-z"),
				git("diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"),
				git("diff", "--cached", "--no-ext-diff", "--no-textconv", "--binary"),
				files,
			]),
		};
	} catch {
		return;
	}
}

export interface RecoveryCheckpoint {
	version: 1;
	id: string;
	taskId: string;
	stepId: string;
	revision: string;
	repository: RepositoryIdentity;
	prHeads: Array<{ url: string; head: string; reference: string }>;
	authorizationSources: string[];
	gates: string[];
	evidence: Array<{
		id: string;
		references: string[];
		revision: string | null;
	}>;
	children: string[];
	allowedActions: string[];
	nextAction: string;
}

export function checkpoint(
	state: TaskState,
	branch: BranchEntry[],
	repo: RepositoryIdentity | undefined,
): RecoveryCheckpoint | undefined {
	const task = state.activeTaskId ? state.tasks[state.activeTaskId] : undefined;
	const resume = buildTaskResume(state);
	if (!task || !repo || !resume.currentStepId || !task.updatedAt) return;
	const userSources = branch
		.filter(
			(entry) =>
				entry.id &&
				entry.type === "message" &&
				(entry as BranchEntry & { message?: { role?: string } }).message
					?.role === "user",
		)
		.map((entry) => `session-entry:${entry.id}`);
	const authorizationSources = [
		...userSources,
		...task.decisions
			.filter((d) => d.decidedBy === "user")
			.map((d) => `task-decision:${d.id}`),
	];
	if (authorizationSources.length === 0) return;
	const lanes = task.handoff ?? [];
	const body = {
		version: 1 as const,
		taskId: task.id,
		stepId: resume.currentStepId,
		revision: task.updatedAt,
		repository: repo,
		prHeads: lanes.flatMap((lane) => (lane.pr ? [lane.pr] : [])),
		authorizationSources,
		gates: [
			...task.blockers
				.filter((b) => !b.resolvedAt)
				.map((b) => `${b.id}:${b.reason}`),
			...lanes.flatMap((l) => (l.pendingDecision ? [l.pendingDecision] : [])),
		],
		evidence: task.evidence.map((e) => ({
			id: e.id,
			references: [...e.references, ...e.quality.artifactRefs],
			revision:
				lanes.find(
					(l) =>
						l.lastVerifiedGate?.reference &&
						[...e.references, ...e.quality.artifactRefs].includes(
							l.lastVerifiedGate.reference,
						),
				)?.lastVerifiedGate?.head ?? null,
		})),
		children: lanes.flatMap((l) => (l.worker ? [l.worker.runId] : [])),
		allowedActions: resume.nextAllowedActions,
		nextAction: task.nextAction || resume.resumeInstruction,
	};
	const result = { ...body, id: digest(body) };
	return validCheckpoint(result) ? result : undefined;
}

export interface RecoveryObservation {
	operation: string;
	authorizationSource?: string;
	authorizationRevision?: string;
	prHeads?: Array<{ url: string; head: string }>;
	children?: Array<{
		runId: string;
		status: "running" | "completed" | "failed";
	}>;
}

export function recoveryChecks(
	saved: RecoveryCheckpoint,
	current: RecoveryCheckpoint | undefined,
	observation?: RecoveryObservation,
) {
	const identity: Verdict = !current
		? "unknown"
		: saved.taskId === current.taskId &&
				saved.stepId === current.stepId &&
				saved.revision === current.revision &&
				digest(saved.repository) === digest(current.repository)
			? "pass"
			: "mismatch";
	let authority: Verdict = "unknown";
	if (observation && current) {
		if (
			!saved.allowedActions.includes(observation.operation) ||
			!current.allowedActions.includes(observation.operation) ||
			saved.revision !== current.revision ||
			current.gates.length > 0
		)
			authority = "mismatch";
		else if (
			observation.authorizationSource &&
			observation.authorizationRevision
		)
			authority =
				saved.authorizationSources.includes(observation.authorizationSource) &&
				current.authorizationSources.includes(
					observation.authorizationSource,
				) &&
				observation.authorizationRevision === current.revision
					? "pass"
					: "mismatch";
	}
	const evidence = saved.evidence.map((e) => ({
		id: e.id,
		result:
			!current || e.revision === null
				? ("unknown" as Verdict)
				: e.revision === current.repository.head &&
						current.evidence.some((c) => digest(c) === digest(e))
					? ("pass" as Verdict)
					: ("mismatch" as Verdict),
	}));
	const children: Verdict =
		saved.children.length === 0
			? "pass"
			: !observation?.children
				? "unknown"
				: saved.children.every((id) =>
							observation.children?.some((c) => c.runId === id),
						)
					? "pass"
					: "mismatch";
	const pr: Verdict =
		saved.prHeads.length === 0
			? "unknown"
			: !observation?.prHeads
				? "unknown"
				: saved.prHeads.every((p) =>
							observation.prHeads?.some(
								(fresh) => fresh.url === p.url && fresh.head === p.head,
							),
						)
					? "pass"
					: "mismatch";
	return {
		identity,
		authority,
		evidence,
		children,
		pr,
		operation: observation?.operation ?? null,
		authorityGranted: false,
		instruction:
			"Observational comparison only, not execution permission. Obtain operation-scoped live ownership/authorization and PR/run observations. Revalidate only affected evidence revisions; inspect existing child runs, never relaunch from this checkpoint. Authorization mismatch stops the affected action, not unrelated safe work.",
	};
}

function validCheckpoint(value: unknown): value is RecoveryCheckpoint {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const data = value as RecoveryCheckpoint;
	const text = (v: unknown) => typeof v === "string" && v.length > 0;
	const strings = (v: unknown) => Array.isArray(v) && v.every(text);
	const record = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === "object" && !Array.isArray(v);
	try {
		const { id, ...body } = data;
		return (
			data.version === 1 &&
			[data.id, data.taskId, data.stepId, data.revision, data.nextAction].every(
				text,
			) &&
			record(data.repository) &&
			[
				data.repository.cwd,
				data.repository.branch,
				data.repository.head,
				data.repository.dirtyStateReference,
			].every(text) &&
			strings(data.authorizationSources) &&
			strings(data.gates) &&
			strings(data.children) &&
			strings(data.allowedActions) &&
			Array.isArray(data.evidence) &&
			data.evidence.every(
				(e) =>
					record(e) &&
					text(e.id) &&
					strings(e.references) &&
					(e.revision === null || text(e.revision)),
			) &&
			Array.isArray(data.prHeads) &&
			data.prHeads.every(
				(p) => record(p) && [p.url, p.head, p.reference].every(text),
			) &&
			Buffer.byteLength(JSON.stringify(data)) <= 64 * 1024 &&
			id === digest(body)
		);
	} catch {
		return false;
	}
}

export function latestCheckpoint(
	branch: BranchEntry[],
): RecoveryCheckpoint | undefined {
	for (const entry of [...branch].reverse()) {
		if (entry.type !== "custom" || entry.customType !== RECOVERY_ENTRY)
			continue;
		const data = entry.data;
		if (validCheckpoint(data)) return data;
	}
}
