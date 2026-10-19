export function distribution(values) {
    const known = values
        .filter((v) => v !== null && Number.isFinite(v) && v >= 0)
        .sort((a, b) => a - b);
    const n = known.length;
    const lower = known[Math.floor((n - 1) / 2)];
    const upper = known[Math.floor(n / 2)];
    return {
        n,
        missing: values.length - n,
        median: lower !== undefined && upper !== undefined ? (lower + upper) / 2 : null,
        p90: known[Math.ceil(n * 0.9) - 1] ?? null,
    };
}
const elapsed = (start, end) => {
    const ms = Date.parse(end ?? "") - Date.parse(start ?? "");
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
};
const unique = (values) => [...new Set(values)];
const rootKey = (r) => r.rootId;
const assignmentKey = (root, task) => JSON.stringify([root, task]);
const attemptKey = (r) => `${r.sessionId}:${r.compactionId ?? r.id}`;
const checks = ["identity", "authority", "evidence", "children"];
/** Metadata-only observational report; no adoption or execution authority is granted. */
export function buildReport(input, from, to, labels = {}, invalidFiles = 0) {
    if (!Number.isFinite(Date.parse(from)) ||
        !Number.isFinite(Date.parse(to)) ||
        Date.parse(from) >= Date.parse(to))
        throw new Error("Invalid report period");
    const byId = new Map();
    let conflictingEvents = 0;
    for (const r of input) {
        const prior = byId.get(r.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(r))
            conflictingEvents++;
        else
            byId.set(r.id, r);
    }
    const all = [...byId.values()]
        .filter((r) => r.timestamp < to)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp) ||
        a.sequence - b.sequence ||
        a.id.localeCompare(b.id));
    const period = all.filter((r) => r.timestamp >= from);
    const assignments = new Map();
    const conflicts = new Set();
    const rootCohorts = new Map();
    for (const r of all) {
        const root = rootKey(r);
        if (!root || !r.cohort)
            continue;
        const key = assignmentKey(root, r.taskId);
        const prior = assignments.get(key);
        if (prior && prior !== r.cohort)
            conflicts.add(root);
        else if (!prior)
            assignments.set(key, r.cohort);
    }
    for (const r of all) {
        if (!r.rootId)
            continue;
        const assigned = assignments.get(assignmentKey(r.rootId, r.taskId));
        if (!assigned)
            continue;
        const values = rootCohorts.get(r.rootId) ?? new Set();
        values.add(assigned);
        rootCohorts.set(r.rootId, values);
    }
    const assignedCohort = (root, task) => {
        const values = rootCohorts.get(root);
        return (assignments.get(assignmentKey(root, task)) ??
            (values?.size === 1 ? [...values][0] : undefined) ??
            "unknown");
    };
    const cohort = (r) => r.rootId ? assignedCohort(r.rootId, r.taskId) : "unknown";
    const sessions = unique(all.map((r) => r.sessionId));
    const roots = unique(all.map(rootKey).filter((x) => x !== null));
    const rootRows = roots.map((root) => {
        const events = all.filter((r) => rootKey(r) === root);
        const children = unique(events.filter((r) => r.sessionId !== root).map((r) => r.sessionId));
        const latestBySession = new Map();
        for (const r of events)
            latestBySession.set(r.sessionId, r);
        const tasks = unique(events.map((r) => r.taskId).filter((x) => !!x));
        return {
            rootId: root,
            cohort: rootCohorts.get(root)?.size === 1
                ? ([...(rootCohorts.get(root) ?? [])][0] ?? "unknown")
                : rootCohorts.has(root)
                    ? "mixed"
                    : "unknown",
            assignmentConflict: conflicts.has(root),
            children: children.length,
            sessions: latestBySession.size,
            activeInPeriod: events.some((r) => r.timestamp >= from),
            sessionsWithoutShutdown: [...latestBySession.values()].filter((r) => r.kind !== "session_end").length,
            tasks: tasks.map((taskId) => {
                const label = labels.tasks?.[taskId];
                const completedAt = Date.parse(label?.completedAt ?? "");
                const completed = Number.isFinite(completedAt) && completedAt < Date.parse(to);
                return {
                    taskId,
                    cohort: assignedCohort(root, taskId),
                    taskClass: label?.taskClass ?? "unknown",
                    status: completed
                        ? "complete"
                        : label?.status === "abandoned"
                            ? "abandoned"
                            : "incomplete",
                    durationMs: completed
                        ? elapsed(label?.startedAt, label?.completedAt)
                        : null,
                };
            }),
        };
    });
    const summarize = (rows) => {
        const starts = rows.filter((r) => r.kind === "compaction_start");
        const ends = rows.filter((r) => r.kind === "compaction_end");
        const attempts = unique([...starts, ...ends].map(attemptKey));
        const phaseStarts = rows.filter((r) => r.kind === "phase_start");
        const phaseDurations = phaseStarts.map((s) => {
            const end = all.find((e) => e.kind === "phase_end" &&
                e.phaseId !== null &&
                e.phaseId === s.phaseId &&
                e.sessionId === s.sessionId &&
                e.sequence > s.sequence);
            return elapsed(s.timestamp, end?.timestamp);
        });
        const recoveryEnds = ends.filter((r) => r.outcome === "success");
        const recoveryRows = recoveryEnds.map((end) => all.find((r) => r.kind === "recovery" &&
            r.sessionId === end.sessionId &&
            r.compactionId !== null &&
            r.compactionId === end.compactionId &&
            r.sequence > end.sequence));
        const latency = recoveryEnds.map((end) => {
            const useful = all.find((r) => r.kind === "useful_action" &&
                r.outcome === "success" &&
                r.sessionId === end.sessionId &&
                r.compactionId !== null &&
                r.compactionId === end.compactionId &&
                r.sequence > end.sequence);
            return elapsed(end.timestamp, useful?.timestamp);
        });
        const verdicts = Object.fromEntries(checks.map((check) => [
            check,
            {
                pass: recoveryRows.filter((r) => r?.recovery?.[check] === "pass")
                    .length,
                mismatch: recoveryRows.filter((r) => r?.recovery?.[check] === "mismatch").length,
                unknown: recoveryRows.filter((r) => !r?.recovery || r.recovery[check] === "unknown").length,
            },
        ]));
        const operations = rows.filter((r) => r.kind === "usage" || r.kind === "compaction_end");
        const usage = Object.fromEntries(["input", "output", "cacheRead", "cacheWrite", "totalTokens"].map((key) => {
            const values = operations.map((r) => r.usage[key]);
            return [
                key,
                {
                    ...distribution(values),
                    knownTotal: values.reduce((sum, v) => sum + (v ?? 0), 0),
                },
            ];
        }));
        const costs = operations.map((r) => r.usage.cost.total);
        const checkpoints = rows.filter((r) => r.kind === "checkpoint" && r.evidenceId !== null);
        return {
            events: rows.length,
            roots: unique(rows.map(rootKey).filter(Boolean)).length,
            phaseDurationMs: distribution(phaseDurations),
            compactions: {
                attempts: attempts.length,
                failures: ends.filter((r) => r.outcome === "failure").length,
                aborted: ends.filter((r) => r.outcome === "abort").length,
                success: ends.filter((r) => r.outcome === "success").length,
                incomplete: starts.filter((s) => !all.some((e) => e.kind === "compaction_end" && attemptKey(e) === attemptKey(s))).length,
                orphanOutcomes: ends.filter((e) => e.missingStart ||
                    !all.some((s) => s.kind === "compaction_start" &&
                        attemptKey(s) === attemptKey(e))).length,
                retrySignals: ends.filter((r) => r.willRetry === true).length,
                retryUnknown: ends.filter((r) => r.willRetry === null).length,
                durationMs: distribution(ends.map((r) => r.durationMs)),
                contextBefore: distribution(ends.map((e) => all.find((s) => s.kind === "compaction_start" &&
                    attemptKey(s) === attemptKey(e))?.context.tokens ?? null)),
                contextAfter: distribution(ends.map((r) => r.context.tokens)),
            },
            recovery: {
                opportunities: recoveryEnds.length,
                checks: verdicts,
                usefulActionLatencyMs: distribution(latency),
            },
            usage,
            cost: {
                ...distribution(costs),
                knownTotal: costs.reduce((sum, v) => sum + (v ?? 0), 0),
                complete: costs.every((v) => v !== null) && costs.length > 0,
            },
            proxies: {
                rereads: null,
                repeatedEvidenceReferences: checkpoints.length -
                    unique(checkpoints.map((r) => `${r.sessionId}:${r.evidenceId}`))
                        .length,
                limitation: "Repeated checkpoint evidence references are a proxy, not proven repeated or wasted work. Reread instrumentation unavailable.",
            },
        };
    };
    const groups = new Map();
    for (const r of period) {
        const key = JSON.stringify([
            cohort(r),
            r.provider,
            r.model,
            labels.tasks?.[r.taskId ?? ""]?.taskClass ?? "unknown",
            labels.phases?.[r.phaseId ?? ""] ?? "unknown",
            r.policyVersion,
            r.configVersion,
        ]);
        const group = groups.get(key) ?? [];
        group.push(r);
        groups.set(key, group);
    }
    return {
        schemaVersion: 1,
        period: { from, to, timezone: "America/Los_Angeles" },
        quality: {
            invalidFiles,
            conflictingEvents,
            assignmentConflicts: conflicts.size,
            replayedEvents: input.length - byId.size,
            sessions: sessions.length,
            unknownRootSessions: unique(all.filter((r) => !rootKey(r)).map((r) => r.sessionId)).length,
            unknownCohortRoots: roots.filter((r) => !rootCohorts.has(r)).length,
        },
        denominator: "All observed roots assigned or unassigned before cutoff, including inactive/incomplete/abandoned; period metrics use [from,to). Shutdown is not task completion. Children are not independent root samples.",
        roots: rootRows,
        cohorts: ["baseline", "pilot", "unknown"].map((name) => {
            const assigned = rootRows.filter((r) => r.cohort === name || rootCohorts.get(r.rootId)?.has(name));
            const tasks = assigned.flatMap((r) => r.tasks.filter((t) => t.cohort === name));
            return {
                cohort: name,
                assignedRoots: assigned.length,
                activeRoots: assigned.filter((r) => r.activeInPeriod).length,
                incompleteTasks: tasks.filter((t) => t.status === "incomplete").length,
                abandonedTasks: tasks.filter((t) => t.status === "abandoned").length,
                taskDurationMs: distribution(tasks.map((t) => t.durationMs)),
                ...summarize(period.filter((r) => cohort(r) === name)),
            };
        }),
        strata: [...groups].map(([key, rows]) => ({
            dimensions: JSON.parse(key),
            ...summarize(rows),
        })),
        stratumDimensions: [
            "cohort",
            "provider",
            "model",
            "taskClass",
            "phaseClass",
            "policyVersion",
            "configVersion",
        ],
        conclusion: {
            adopt: false,
            reason: "Non-adoption: observational/configured cohorts, unknown semantic coverage or insufficient controlled evidence; descriptive metrics do not establish a causal benefit. No automatic rollout.",
        },
    };
}
