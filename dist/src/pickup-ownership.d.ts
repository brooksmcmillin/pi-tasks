export declare const PICKUP_OWNERSHIP_EVENT = "task-continuation:ownership";
/** The pickup guard owns recovery, including exhausted and explicit boundary states. */
export declare function pickupOwnsRecovery(value: unknown): boolean | undefined;
