import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ReportLabels } from "./src/compaction-report.ts";
import { runWeekly } from "./src/compaction-report-delivery.ts";

const args = process.argv.slice(2);
const allowed = new Set(["--telemetry", "--output", "--labels", "--now"]);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
	const key = args[i],
		value = args[i + 1];
	if (!key || !allowed.has(key) || !value || options.has(key))
		throw new Error(
			"Usage: report.js [--telemetry DIR] [--output DIR] [--labels JSON] [--now ISO]",
		);
	options.set(key, value);
}
try {
	const labelsPath = options.get("--labels");
	const now = options.get("--now");
	const result = runWeekly({
		telemetryDirectory:
			options.get("--telemetry") ??
			process.env.PI_TASKS_TELEMETRY_DIR ??
			join(homedir(), ".pi/agent/telemetry/compaction-v1"),
		outputDirectory:
			options.get("--output") ??
			join(homedir(), ".local/state/pi-compaction-reports"),
		...(now ? { now: new Date(now) } : {}),
		...(labelsPath
			? { labels: JSON.parse(readFileSync(labelsPath, "utf8")) as ReportLabels }
			: {}),
		notify: ({ message }) => {
			execFileSync(
				"notify-send",
				["--app-name=pi-compaction", "Pi compaction experiment", message],
				{ timeout: 10_000, stdio: "ignore" },
			);
		},
	});
	// Paths/record identities remain private. The user unit's status/log is sufficient for failures.
	console.log(
		`Weekly compaction report persisted; notifications acknowledged: ${result.sent}; invalid files: ${result.invalidFiles}`,
	);
	if (result.invalidFiles) process.exitCode = 1;
} catch {
	console.error(
		"Compaction reporting failed. Check private input/output permissions, notification service and lock; no content was logged.",
	);
	process.exitCode = 1;
}
