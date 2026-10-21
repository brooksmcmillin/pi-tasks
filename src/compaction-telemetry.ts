import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const PHASE_EVENT = "pi-tasks:phase";
export const TELEMETRY_VERSION = 1;
type ObjectValue = Record<string, unknown>;
export const object = (value: unknown): ObjectValue =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as ObjectValue)
		: {};
const number = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
export const identity = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0
		? createHash("sha256").update(value).digest("hex")
		: null;
const hash = (value: unknown): string =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
const choice = <T extends string>(
	value: unknown,
	choices: readonly T[],
): T | null => (choices.includes(value as T) ? (value as T) : null);

export function usage(value: unknown) {
	const data = object(value);
	const cost = object(data.cost);
	return {
		scope: "operation" as const,
		input: number(data.input),
		output: number(data.output),
		cacheRead: number(data.cacheRead),
		cacheWrite: number(data.cacheWrite),
		totalTokens: number(data.totalTokens),
		cost: {
			input: number(cost.input),
			output: number(cost.output),
			cacheRead: number(cost.cacheRead),
			cacheWrite: number(cost.cacheWrite),
			total: number(cost.total),
		},
	};
}

const POLICY_DECISIONS = [
	"baseline",
	"unknown-context",
	"busy",
	"below-eligibility",
	"unknown-checkpoint",
	"fallback",
	"phase-target",
	"before-target",
	"await-phase-boundary",
	"retention-mismatch",
] as const;
export interface TelemetryRecord {
	policyDecision?: (typeof POLICY_DECISIONS)[number];
	schemaVersion: 1;
	sequence: number;
	id: string;
	kind:
		| "session_start"
		| "session_end"
		| "phase_start"
		| "phase_end"
		| "checkpoint"
		| "recovery"
		| "useful_action"
		| "usage"
		| "compaction_start"
		| "compaction_end";
	timestamp: string;
	sourceTimestamp: string | null;
	sessionId: string;
	rootId: string | null;
	parentId: string | null;
	taskId: string | null;
	phaseId: string | null;
	compactionId: string | null;
	checkpointId: string | null;
	evidenceId: string | null;
	policyVersion: string | null;
	configVersion: string | null;
	cohort: "baseline" | "pilot" | null;
	provider: string | null;
	model: string | null;
	context: {
		tokens: number | null;
		window: number | null;
		provenance: "runtime_estimate" | "preparation" | "unknown";
	};
	usage: ReturnType<typeof usage>;
	outcome: "success" | "failure" | "abort" | "unknown" | null;
	reason: "manual" | "threshold" | "overflow" | null;
	willRetry: boolean | null;
	durationMs: number | null;
	missingStart: boolean;
	missingIdentity: boolean;
	recovery: {
		identity: "pass" | "mismatch" | "unknown";
		authority: "pass" | "mismatch" | "unknown";
		evidence: "pass" | "mismatch" | "unknown";
		children: "pass" | "mismatch" | "unknown";
	} | null;
}

type Check = (value: unknown) => boolean;
const nullable =
	(check: Check): Check =>
	(value) =>
		value === null || check(value);
const numeric: Check = (value) => number(value) !== null;
const digest: Check = (value) =>
	typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const timestamp: Check = (value) =>
	typeof value === "string" &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value;
const member =
	(values: readonly unknown[]): Check =>
	(value) =>
		values.includes(value);
const shape =
	(checks: Record<string, Check>): Check =>
	(value) => {
		const data = object(value);
		return (
			Object.keys(data).length === Object.keys(checks).length &&
			Object.entries(checks).every(
				([key, check]) => Object.hasOwn(data, key) && check(data[key]),
			)
		);
	};
const counters = shape({
	input: nullable(numeric),
	output: nullable(numeric),
	cacheRead: nullable(numeric),
	cacheWrite: nullable(numeric),
	total: nullable(numeric),
});
const recordChecks: Record<
	Exclude<keyof TelemetryRecord, "policyDecision">,
	Check
> = {
	schemaVersion: member([1]),
	sequence: (value) =>
		typeof value === "number" && Number.isSafeInteger(value) && value > 0,
	id: digest,
	kind: member([
		"session_start",
		"session_end",
		"phase_start",
		"phase_end",
		"checkpoint",
		"recovery",
		"useful_action",
		"usage",
		"compaction_start",
		"compaction_end",
	]),
	timestamp,
	sourceTimestamp: nullable(timestamp),
	sessionId: digest,
	rootId: nullable(digest),
	parentId: nullable(digest),
	taskId: nullable(digest),
	phaseId: nullable(digest),
	compactionId: nullable(digest),
	checkpointId: nullable(digest),
	evidenceId: nullable(digest),
	policyVersion: nullable(digest),
	configVersion: nullable(digest),
	provider: nullable(digest),
	model: nullable(digest),
	cohort: member([null, "baseline", "pilot"]),
	context: shape({
		tokens: nullable(numeric),
		window: nullable(numeric),
		provenance: member(["runtime_estimate", "preparation", "unknown"]),
	}),
	usage: shape({
		scope: member(["operation"]),
		input: nullable(numeric),
		output: nullable(numeric),
		cacheRead: nullable(numeric),
		cacheWrite: nullable(numeric),
		totalTokens: nullable(numeric),
		cost: counters,
	}),
	outcome: member([null, "success", "failure", "abort", "unknown"]),
	reason: member([null, "manual", "threshold", "overflow"]),
	willRetry: member([null, true, false]),
	durationMs: nullable(numeric),
	missingStart: member([true, false]),
	missingIdentity: member([true, false]),
	recovery: nullable(
		shape({
			identity: member(["pass", "mismatch", "unknown"]),
			authority: member(["pass", "mismatch", "unknown"]),
			evidence: member(["pass", "mismatch", "unknown"]),
			children: member(["pass", "mismatch", "unknown"]),
		}),
	),
};
const validRecord = (value: unknown): value is TelemetryRecord => {
	const { policyDecision, ...record } = object(value);
	return (
		shape(recordChecks)(record) &&
		(policyDecision === undefined ||
			POLICY_DECISIONS.includes(
				policyDecision as (typeof POLICY_DECISIONS)[number],
			))
	);
};

/** Immutable, exclusive event files give replay deduplication without a second index. */
export class TelemetryStore {
	readonly directory: string;
	constructor(directory: string) {
		this.directory = directory;
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const stat = lstatSync(directory);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			stat.uid !== process.getuid?.() ||
			(stat.mode & 0o077) !== 0
		)
			throw new Error("Telemetry directory must be private and owned");
	}
	put(record: TelemetryRecord): void {
		if (!validRecord(record)) throw new Error("Invalid telemetry record");
		const path = join(this.directory, `${record.id}.json`);
		let fd: number;
		try {
			fd = openSync(
				path,
				constants.O_WRONLY |
					constants.O_CREAT |
					constants.O_EXCL |
					constants.O_NOFOLLOW,
				0o600,
			);
		} catch (error) {
			if (object(error).code === "EEXIST") return;
			throw error;
		}
		try {
			writeFileSync(fd, `${JSON.stringify(record)}\n`);
		} finally {
			closeSync(fd);
		}
	}
	read(): { records: TelemetryRecord[]; invalidFiles: number } {
		const records: TelemetryRecord[] = [];
		let invalidFiles = 0;
		for (const name of readdirSync(this.directory).sort()) {
			if (!/^[a-f0-9]{64}\.json$/.test(name)) {
				invalidFiles++;
				continue;
			}
			let fd: number | undefined;
			try {
				fd = openSync(
					join(this.directory, name),
					constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
				);
				const stat = fstatSync(fd);
				if (
					!stat.isFile() ||
					stat.size > 16384 ||
					stat.uid !== process.getuid?.() ||
					(stat.mode & 0o077) !== 0
				)
					throw new Error("Invalid telemetry file");
				const record: unknown = JSON.parse(readFileSync(fd, "utf8"));
				if (!validRecord(record) || `${record.id}.json` !== name)
					throw new Error("Invalid telemetry record");
				records.push(record);
			} catch {
				invalidFiles++;
			} finally {
				if (fd !== undefined) closeSync(fd);
			}
		}
		return {
			records: records.sort(
				(a, b) =>
					a.timestamp.localeCompare(b.timestamp) ||
					a.sequence - b.sequence ||
					a.id.localeCompare(b.id),
			),
			invalidFiles,
		};
	}
}

export function coverage(records: TelemetryRecord[]) {
	const starts = records.filter((r) => r.kind === "compaction_start");
	const ends = records.filter((r) => r.kind === "compaction_end");
	const phaseStarts = records.filter((r) => r.kind === "phase_start");
	const latest = new Map<string, TelemetryRecord>();
	for (const record of records) {
		const previous = latest.get(record.sessionId);
		if (!previous || record.sequence > previous.sequence)
			latest.set(record.sessionId, record);
	}
	return {
		incompleteCompactions: starts
			.filter(
				(r) =>
					!ends.some(
						(e) =>
							r.compactionId !== null &&
							e.compactionId === r.compactionId &&
							e.sessionId === r.sessionId &&
							e.sequence > r.sequence,
					),
			)
			.map((r) => r.compactionId),
		orphanOutcomes: ends
			.filter(
				(r) =>
					r.missingStart ||
					!starts.some(
						(s) =>
							r.compactionId !== null &&
							s.compactionId === r.compactionId &&
							s.sessionId === r.sessionId &&
							s.sequence < r.sequence,
					),
			)
			.map((r) => r.compactionId),
		incompletePhases: phaseStarts
			.filter(
				(r) =>
					!records.some(
						(e) =>
							e.kind === "phase_end" &&
							r.phaseId !== null &&
							e.phaseId === r.phaseId &&
							e.sessionId === r.sessionId &&
							e.sequence > r.sequence,
					),
			)
			.map((r) => r.phaseId),
		sessionsWithoutEnd: [...latest.values()]
			.filter((record) => record.kind !== "session_end")
			.map((record) => record.sessionId),
	};
}

export interface TelemetryContext {
	sessionManager: {
		getSessionId?(): string;
		getLeafId?(): string | null;
		getHeader?(): { id: string; parentSession?: string } | null;
	};
	getContextUsage?():
		| { tokens: number | null; contextWindow: number }
		| undefined;
	model?: { provider: string; id: string };
}

export function createCollector(
	store: Pick<TelemetryStore, "put"> & Partial<Pick<TelemetryStore, "read">>,
	warn: () => void,
	now = () => new Date().toISOString(),
) {
	let ctx: TelemetryContext;
	let sessionId: string | null = null;
	let parentId: string | null = null;
	let rootId: string | null = null;
	let taskId: string | null = null;
	let phaseId: string | null = null;
	let policyVersion: string | null = null;
	let configVersion: string | null = null;
	let cohort: TelemetryRecord["cohort"] = null;
	let checkpointId: string | null = null;
	let lastCompactionId: string | null = null;
	const correlation = () => ({
		rootId,
		parentId,
		taskId,
		phaseId,
		checkpointId,
		policyVersion,
		configVersion,
		cohort,
		provider: identity(ctx.model?.provider),
		model: identity(ctx.model?.id),
	});
	let pending:
		| { id: string; at: string; fields: ReturnType<typeof correlation> }
		| undefined;
	const seenIds = new Set<string>();
	let warned = false;
	let ended = false;
	let sequence = 0;
	let modelIdentity: string | null = null;
	const duplicate = (kind: TelemetryRecord["kind"], source: string) =>
		seenIds.has(hash([sessionId, kind, source]));
	const safe = (action: () => void) => {
		try {
			action();
		} catch {
			if (!warned) {
				warned = true;
				try {
					warn();
				} catch {
					/* No telemetry failure may change ordinary work. */
				}
			}
		}
	};
	const write = (
		kind: TelemetryRecord["kind"],
		source: string,
		fields: Partial<TelemetryRecord> = {},
	) => {
		if (!sessionId) return;
		const context = ctx.getContextUsage?.();
		const id = hash([sessionId, kind, source]);
		if (seenIds.has(id)) return;
		store.put({
			schemaVersion: 1,
			sequence: ++sequence,
			id,
			kind,
			timestamp: now(),
			sourceTimestamp: null,
			sessionId,
			...correlation(),
			compactionId: lastCompactionId,
			evidenceId: null,
			context: {
				tokens: number(context?.tokens),
				window: number(context?.contextWindow),
				provenance: context ? "runtime_estimate" : "unknown",
			},
			usage: usage(undefined),
			outcome: null,
			reason: null,
			willRetry: null,
			durationMs: null,
			missingStart: false,
			missingIdentity: false,
			recovery: null,
			...fields,
		});
		seenIds.add(id);
	};
	return {
		start(context: TelemetryContext) {
			safe(() => {
				ctx = context;
				modelIdentity = hash([ctx.model?.provider, ctx.model?.id]);
				sessionId = identity(ctx.sessionManager.getSessionId?.());
				const header = ctx.sessionManager.getHeader?.();
				parentId = identity(header?.parentSession);
				rootId = header && !parentId ? sessionId : null;
				taskId = phaseId = policyVersion = configVersion = null;
				cohort = null;
				pending = undefined;
				ended = false;
				const records =
					store
						.read?.()
						.records.filter((record) => record.sessionId === sessionId) ?? [];
				seenIds.clear();
				for (const record of records) seenIds.add(record.id);
				records.sort((a, b) => a.sequence - b.sequence);
				const latest = records.at(-1);
				// Terminals carry the attempt's snapshot, not subsequently observed live metadata.
				const prior = records
					.filter((record) => record.kind !== "compaction_end")
					.at(-1);
				checkpointId = prior?.checkpointId ?? null;
				lastCompactionId =
					records.filter((record) => record.kind === "compaction_end").at(-1)
						?.compactionId ?? null;
				sequence = latest?.sequence ?? 0;
				if (prior) {
					rootId = prior.rootId;
					taskId = prior.taskId;
					phaseId = prior.phaseId;
					policyVersion = prior.policyVersion;
					configVersion =
						prior.provider === identity(ctx.model?.provider) &&
						prior.model === identity(ctx.model?.id)
							? prior.configVersion
							: null;
					cohort = prior.cohort;
				}
				write("session_start", "start");
			});
		},
		bind(context: TelemetryContext) {
			const nextModel = hash([context.model?.provider, context.model?.id]);
			if (nextModel !== modelIdentity) configVersion = null;
			modelIdentity = nextModel;
			ctx = context;
		},
		marker(value: unknown) {
			safe(() => {
				const data = object(value);
				const kind = choice(data.kind, [
					"phase_start",
					"phase_end",
					"checkpoint",
					"recovery",
					"useful_action",
				] as const);
				if (
					data.version !== 1 ||
					!kind ||
					typeof data.id !== "string" ||
					!data.id
				)
					return;
				if (duplicate(kind, data.id)) return;
				if (data.taskId !== undefined) {
					const nextTaskId = identity(data.taskId);
					if (nextTaskId !== taskId) checkpointId = phaseId = null;
					taskId = nextTaskId;
				}
				if (data.checkpointId !== undefined)
					checkpointId = identity(data.checkpointId);
				if (data.rootSessionId !== undefined)
					rootId = identity(data.rootSessionId);
				if (data.phaseId !== undefined) phaseId = identity(data.phaseId);
				if (data.policyVersion !== undefined)
					policyVersion = identity(data.policyVersion);
				if (data.configVersion !== undefined)
					configVersion = identity(data.configVersion);
				if (data.cohort !== undefined)
					cohort = choice(data.cohort, ["baseline", "pilot"]);
				const checks = object(data.recovery);
				const verdict = (key: string) =>
					choice(checks[key], ["pass", "mismatch", "unknown"] as const) ??
					"unknown";
				const policyDecision = choice(data.policyDecision, POLICY_DECISIONS);
				write(kind, data.id, {
					...(policyDecision ? { policyDecision } : {}),
					compactionId:
						data.compactionId === undefined
							? lastCompactionId
							: identity(data.compactionId),
					checkpointId,
					evidenceId: identity(data.evidenceId),
					outcome: choice(data.outcome, [
						"success",
						"failure",
						"abort",
						"unknown",
					]),
					recovery:
						kind === "recovery"
							? {
									identity: verdict("identity"),
									authority: verdict("authority"),
									evidence: verdict("evidence"),
									children: verdict("children"),
								}
							: null,
				});
			});
		},
		before(value: unknown) {
			safe(() => {
				const data = object(value);
				const source =
					typeof data.attemptId === "string" && data.attemptId
						? data.attemptId
						: randomUUID();
				if (duplicate("compaction_start", source)) return;
				const prep = object(data.preparation);
				const settings = object(prep.settings);
				configVersion = hash({
					provider: ctx.model?.provider,
					model: ctx.model?.id,
					reserveTokens: number(settings.reserveTokens),
					keepRecentTokens: number(settings.keepRecentTokens),
				});
				pending = { id: source, at: now(), fields: correlation() };
				write("compaction_start", pending.id, {
					compactionId: identity(pending.id),
					reason: choice(data.reason, ["manual", "threshold", "overflow"]),
					willRetry:
						typeof data.willRetry === "boolean" ? data.willRetry : null,
					context: {
						tokens: number(prep.tokensBefore),
						window: number(ctx.getContextUsage?.()?.contextWindow),
						provenance: "preparation",
					},
				});
			});
		},
		complete(value: unknown, failed = false) {
			safe(() => {
				const data = object(value);
				const entry = object(data.compactionEntry);
				if (
					typeof entry.id === "string" &&
					duplicate("compaction_end", entry.id)
				)
					return;
				const source =
					pending?.id ??
					(typeof entry.id === "string" ? entry.id : randomUUID());
				const durationMs = pending
					? Math.max(0, Date.parse(now()) - Date.parse(pending.at))
					: null;
				write(
					"compaction_end",
					typeof entry.id === "string" ? entry.id : source,
					{
						compactionId: identity(source),
						...(pending ? pending.fields : {}),
						sourceTimestamp:
							typeof entry.timestamp === "string" &&
							Number.isFinite(Date.parse(entry.timestamp))
								? new Date(entry.timestamp).toISOString()
								: null,
						usage: usage(entry.usage),
						reason: choice(data.reason, ["manual", "threshold", "overflow"]),
						willRetry:
							typeof data.willRetry === "boolean" ? data.willRetry : null,
						outcome: failed
							? data.aborted === true
								? "abort"
								: "failure"
							: "success",
						durationMs,
						missingStart: !pending,
					},
				);
				lastCompactionId = identity(source);
				pending = undefined;
			});
		},
		message(value: unknown) {
			safe(() => {
				const message = object(object(value).message);
				if (message.role !== "assistant") return;
				const counters = usage(message.usage);
				const timestamp = number(message.timestamp);
				// message_end runs before session persistence: the tree leaf is not this message's ID.
				const source =
					timestamp === null
						? randomUUID()
						: hash([
								timestamp,
								counters,
								choice(message.stopReason, [
									"stop",
									"length",
									"toolUse",
									"error",
									"aborted",
								]),
							]);
				write("usage", source, {
					missingIdentity: timestamp === null,
					usage: counters,
					outcome:
						message.stopReason === "aborted"
							? "abort"
							: message.stopReason === "error"
								? "failure"
								: "success",
				});
			});
		},
		end() {
			safe(() => {
				if (ended) return;
				write(
					"session_end",
					hash([ctx.sessionManager.getLeafId?.(), sequence]),
				);
				ended = true;
			});
		},
	};
}
