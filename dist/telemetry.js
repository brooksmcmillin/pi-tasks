import { homedir } from "node:os";
import { join } from "node:path";
import { createCollector, PHASE_EVENT, TelemetryStore, } from "./src/compaction-telemetry.js";
/** Explicitly load this companion; the default package entrypoint stays unchanged. */
export default function telemetry(pi) {
    let collector;
    let unsubscribe;
    pi.on("session_start", (_event, ctx) => {
        try {
            const store = new TelemetryStore(process.env.PI_TASKS_TELEMETRY_DIR ??
                join(homedir(), ".pi", "agent", "telemetry", "compaction-v1"));
            collector = createCollector(store, () => ctx.ui?.notify("Pi telemetry collection failed; coverage may be incomplete.", "warning"));
            collector.start(ctx);
            unsubscribe?.();
            unsubscribe = pi.events.on(PHASE_EVENT, (event) => collector?.marker(event));
        }
        catch {
            collector = undefined;
            try {
                ctx.ui?.notify("Pi telemetry unavailable; ordinary work is unaffected.", "warning");
            }
            catch {
                /* Notification is best-effort. */
            }
        }
    });
    pi.on("session_tree", (_event, ctx) => collector?.bind(ctx));
    pi.on("session_before_compact", (event, ctx) => {
        collector?.bind(ctx);
        collector?.before(event);
    });
    pi.on("session_compact", (event, ctx) => {
        collector?.bind(ctx);
        collector?.complete(event);
    });
    pi.on("session_compact_failed", (event, ctx) => {
        collector?.bind(ctx);
        collector?.complete(event, true);
    });
    pi.on("message_end", (event, ctx) => {
        collector?.bind(ctx);
        collector?.message(event);
    });
    pi.on("session_shutdown", () => {
        collector?.end();
        unsubscribe?.();
        unsubscribe = undefined;
        collector = undefined;
    });
}
