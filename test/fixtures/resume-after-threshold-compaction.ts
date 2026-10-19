/** Pinned local continuation consumer, captured for task 7678 on 2026-10-19.
 * Source: ~/.pi/agent/extensions/resume-after-threshold-compaction.ts.
 * Set PI_THRESHOLD_CONTINUATION_EXTENSION to replay the installed consumer instead.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONTINUATION_MESSAGE = [
	"Pi compacted the context while you were working on the current user request.",
	"Continue the request from the compacted context now; do not stop merely because compaction occurred.",
	"If the work is complete, provide the final user-facing result.",
].join(" ");
export default function resumeAfterThresholdCompaction(pi: ExtensionAPI): void {
	pi.on("session_compact", (event) => {
		if (event.reason !== "threshold" || event.willRetry) return;
		pi.sendMessage(
			{
				customType: "resume-after-threshold-compaction",
				content: CONTINUATION_MESSAGE,
				display: false,
			},
			{ deliverAs: "steer" },
		);
	});
}
