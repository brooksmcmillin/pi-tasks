import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	buildReport,
	type CompactionReport,
	type ReportLabels,
} from "./compaction-report.ts";
import {
	type TelemetryRecord,
	TelemetryStore,
} from "./compaction-telemetry.ts";

export const WEEKLY_CALENDAR = "Sat *-*-* 09:00:00 America/Los_Angeles";
const local = new Intl.DateTimeFormat("en-US", {
	timeZone: "America/Los_Angeles",
	weekday: "short",
	hour: "2-digit",
	hourCycle: "h23",
});
/** Catch up exactly one latest weekly slot; the previous slot accounts for DST. */
export function weeklyCutoff(now: Date): Date {
	if (!Number.isFinite(now.getTime())) throw new Error("Invalid clock");
	const hour = 3_600_000;
	for (
		let t = Math.floor(now.getTime() / hour) * hour, i = 0;
		i < 8 * 24;
		t -= hour, i++
	) {
		const parts = local.formatToParts(t);
		if (
			parts.some((p) => p.type === "weekday" && p.value === "Sat") &&
			parts.some((p) => p.type === "hour" && p.value === "09")
		)
			return new Date(t);
	}
	throw new Error("Weekly cutoff unavailable");
}

function privateDirectory(path: string) {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		stat.uid !== process.getuid?.() ||
		stat.mode & 0o077
	)
		throw new Error("Report directory must be private and owned");
}
function readJson<T>(path: string): T | undefined {
	let fd: number;
	try {
		fd = openSync(
			path,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.mode & 0o077)
			throw new Error("Report file must be private and owned");
		return JSON.parse(readFileSync(fd, "utf8")) as T;
	} finally {
		closeSync(fd);
	}
}
function atomicJson(path: string, value: unknown) {
	// Validate an existing destination, never follow an output symlink.
	readJson<unknown>(path);
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
			flag: "wx",
			mode: 0o600,
		});
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}
interface Notice {
	id: string;
	message: string;
	state: "pending" | "sent";
}
const digest = (text: string) =>
	createHash("sha256").update(text).digest("hex");
function mismatchNotices(records: TelemetryRecord[], to: string): Notice[] {
	return records
		.filter((r) => r.kind === "recovery" && r.timestamp < to)
		.flatMap((r) =>
			(["identity", "authority", "evidence", "children"] as const)
				.filter((check) => r.recovery?.[check] === "mismatch")
				.map((check) => ({
					id: digest(`${r.id}:${check}`),
					message: `Pi compaction: concrete ${check} recovery mismatch. Inspect the private weekly report; this observation grants no execution authority.`,
					state: "pending" as const,
				})),
		);
}

export interface DeliveryOptions {
	telemetryDirectory: string;
	outputDirectory: string;
	now?: Date;
	labels?: ReportLabels;
	/** Must acknowledge delivery or throw. No transcripts, credentials or raw IDs. */
	notify: (notice: { id: string; message: string }) => void;
}
export function runWeekly(options: DeliveryOptions) {
	// A missing collector directory is a failure, not an empty successful experiment.
	lstatSync(options.telemetryDirectory);
	privateDirectory(options.outputDirectory);
	const lock = join(options.outputDirectory, ".lock");
	mkdirSync(lock, { mode: 0o700 });
	try {
		const to = weeklyCutoff(options.now ?? new Date()).toISOString();
		const from = weeklyCutoff(new Date(Date.parse(to) - 1)).toISOString();
		const key = to.replaceAll(":", "-");
		const path = join(options.outputDirectory, `${key}.json`);
		let report = readJson<CompactionReport>(path);
		const input = new TelemetryStore(options.telemetryDirectory).read();
		if (!report) {
			report = buildReport(
				input.records,
				from,
				to,
				options.labels,
				input.invalidFiles,
			);
			atomicJson(path, report);
		}
		atomicJson(join(options.outputDirectory, "latest.json"), {
			schemaVersion: 1,
			period: to,
			report: `${key}.json`,
		});
		const noticesPath = join(options.outputDirectory, "notifications.json");
		const notices = readJson<Record<string, Notice>>(noticesPath) ?? {};
		const weekly: Notice = {
			id: `weekly:${to}`,
			message: `Pi compaction weekly report saved (${to}). Baseline/pilot comparisons and missingness available privately. Non-adoption: controlled evidence insufficient.${report.quality.invalidFiles ? " WARNING: invalid telemetry files." : ""}`,
			state: "pending",
		};
		for (const notice of [weekly, ...mismatchNotices(input.records, to)])
			if (!notices[notice.id]) notices[notice.id] = notice;
		atomicJson(noticesPath, notices);
		let sent = 0;
		for (const notice of Object.values(notices)) {
			if (notice.state === "sent") continue;
			options.notify({ id: notice.id, message: notice.message });
			notice.state = "sent";
			atomicJson(noticesPath, notices);
			sent++;
		}
		return { period: to, report: path, sent, invalidFiles: input.invalidFiles };
	} finally {
		rmdirSync(lock);
	}
}
