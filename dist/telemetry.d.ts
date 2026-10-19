import { type TelemetryContext } from "./src/compaction-telemetry.ts";
interface TelemetryAPI {
    on(event: string, handler: (event: unknown, ctx: TelemetryContext & {
        ui?: {
            notify(message: string, type: "warning"): void;
        };
    }) => void): unknown;
    events: {
        on(event: string, handler: (value: unknown) => void): () => void;
    };
}
/** Explicitly load this companion; the default package entrypoint stays unchanged. */
export default function telemetry(pi: TelemetryAPI): void;
export {};
