import { type ReportLabels } from "./compaction-report.ts";
export declare const WEEKLY_CALENDAR = "Sat *-*-* 09:00:00 America/Los_Angeles";
/** Catch up exactly one latest weekly slot; the previous slot accounts for DST. */
export declare function weeklyCutoff(now: Date): Date;
export interface DeliveryOptions {
    telemetryDirectory: string;
    outputDirectory: string;
    now?: Date;
    labels?: ReportLabels;
    /** Must acknowledge delivery or throw. No transcripts, credentials or raw IDs. */
    notify: (notice: {
        id: string;
        message: string;
    }) => void;
}
export declare function runWeekly(options: DeliveryOptions): {
    period: string;
    report: string;
    sent: number;
    invalidFiles: number;
};
