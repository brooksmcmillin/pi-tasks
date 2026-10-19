import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	runWeekly,
	WEEKLY_CALENDAR,
} from "../src/compaction-report-delivery.ts";
import {
	createCollector,
	TelemetryStore,
} from "../src/compaction-telemetry.ts";

function deliver(root: string, now: string) {
	const path = join(root, "fixture-notices.json");
	const notices = existsSync(path)
		? (JSON.parse(readFileSync(path, "utf8")) as string[])
		: [];
	const result = runWeekly({
		telemetryDirectory: join(root, "telemetry"),
		outputDirectory: join(root, "reports"),
		now: new Date(now),
		notify: ({ id }) => {
			notices.push(id);
			writeFileSync(path, JSON.stringify(notices), { mode: 0o600 });
		},
	});
	writeFileSync(join(root, "last-run.json"), JSON.stringify(result), {
		mode: 0o600,
	});
	return result;
}
if (process.argv[2] === "scheduled") {
	assert(process.argv[3]);
	deliver(resolve(process.argv[3]), "2026-10-17T16:00:00Z");
} else {
	const root = mkdtempSync(join(tmpdir(), "pi-compaction-report-benchmark-"));
	const unit = `pi-report-fixture-${randomUUID()}`;
	const started = performance.now();
	try {
		const store = new TelemetryStore(join(root, "telemetry"));
		let time = "2026-10-16T12:00:00.000Z";
		const c = createCollector(
			store,
			() => {
				throw new Error("collector failed");
			},
			() => time,
		);
		c.start({
			sessionManager: {
				getSessionId: () => "benchmark",
				getHeader: () => ({ id: "benchmark" }),
			},
		});
		c.marker({
			version: 1,
			id: "phase",
			kind: "phase_start",
			cohort: "pilot",
			taskId: "benchmark-task",
			phaseId: "implementation",
		});
		c.before({ attemptId: "attempt", preparation: { tokensBefore: 120_000 } });
		time = "2026-10-16T12:00:02.000Z";
		c.complete({ compactionEntry: { id: "completed" } });
		c.marker({
			version: 1,
			id: "recovery",
			kind: "recovery",
			recovery: { identity: "mismatch" },
		});
		const calendar = execFileSync(
			"systemd-analyze",
			["calendar", "--iterations=2", WEEKLY_CALENDAR],
			{ encoding: "utf8" },
		);
		execFileSync(
			"systemd-run",
			[
				"--user",
				`--unit=${unit}`,
				`--on-calendar=${WEEKLY_CALENDAR}`,
				"--timer-property=Persistent=true",
				"--property=Type=oneshot",
				process.execPath,
				"--experimental-strip-types",
				fileURLToPath(import.meta.url),
				"scheduled",
				root,
			],
			{ stdio: "pipe" },
		);
		const persistent = execFileSync(
			"systemctl",
			["--user", "show", `${unit}.timer`, "--property=Persistent", "--value"],
			{ encoding: "utf8" },
		).trim();
		assert.equal(persistent, "yes");
		// Trigger the fixture service now rather than changing the host clock or waiting a week.
		execFileSync("systemctl", ["--user", "start", `${unit}.service`], {
			stdio: "pipe",
		});
		const first = JSON.parse(
			readFileSync(join(root, "last-run.json"), "utf8"),
		) as { sent: number };
		assert.equal(first.sent, 2);
		const replay = deliver(root, "2026-10-17T18:00:00Z");
		assert.equal(replay.sent, 0);
		const missed = deliver(root, "2026-11-09T12:00:00Z");
		assert.equal(missed.period, "2026-11-07T17:00:00.000Z");
		assert.equal(missed.sent, 1);
		assert.equal(
			readdirSync(join(root, "reports")).filter((p) => p.startsWith("2026"))
				.length,
			2,
		);
		const latest = JSON.parse(
			readFileSync(join(root, "reports/latest.json"), "utf8"),
		) as { period: string };
		assert.equal(latest.period, missed.period);
		console.log(
			JSON.stringify(
				{
					schemaVersion: 1,
					fixture: true,
					calendar: WEEKLY_CALENDAR,
					calendarValidated: calendar.includes("America/Los_Angeles"),
					scheduler:
						"systemd user transient timer and manually triggered oneshot",
					persistent,
					firstNotifications: first.sent,
					replayNotifications: replay.sent,
					missedWindowNotifications: missed.sent,
					mismatchAlertsAcrossPeriods: 1,
					historyPeriods: 2,
					latest: latest.period,
					elapsedMs: Math.round(performance.now() - started),
					limitations:
						"Synthetic clock and notification sink; no live installation, real desktop receipt, daemon restart or runtime cohort performance proved.",
				},
				null,
				2,
			),
		);
	} finally {
		try {
			execFileSync(
				"systemctl",
				["--user", "stop", `${unit}.timer`, `${unit}.service`],
				{ stdio: "pipe" },
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
}
