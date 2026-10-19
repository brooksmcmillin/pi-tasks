# Private weekly compaction comparisons

This opt-in metadata-only consumer reads the [passive telemetry store](compaction-telemetry.md).
It does not install anything, change assignment/policy, upload transcripts, or grant
execution authority. Activation and live delivery verification belong to task 7680.

## Generate and inspect

```sh
npm ci
npm run build
node dist/report.js --telemetry "$HOME/.pi/agent/telemetry/compaction-v1" \
  --output "$HOME/.local/state/pi-compaction-reports"
```

Requires Node 22+, Linux systemd for scheduling, and `notify-send` with a usable
user desktop notification service. Generic notifications contain no raw IDs or
transcript content. Desktop acknowledgement is not proof that a human saw it;
configure the desktop's lock-screen privacy accordingly. Failures exit nonzero
and leave pending notices for retry. No remote notification credential is needed.

The private output directory is 0700; JSON files are 0600. It contains immutable
cutoff-named period reports, `latest.json` pointing to the newest generated period,
and `notifications.json` recording acknowledged weekly/mismatch notice IDs.
Missing input is an error, not an empty cohort. Invalid telemetry is counted and
warned; the CLI exits nonzero. Reports remain descriptive even with partial data.
Report readers must not concurrently remove or mutate the input store.

## Interpretation and missingness

- Weekly periods are `[previous Saturday 09:00 LA, Saturday 09:00 LA)`, including
  DST changes. A late invocation generates only the most recent cutoff, not a
  backlog of notifications. Existing period files are reused on replay; late-arriving
  observations do not silently rewrite historical evidence.
- The assignment denominator includes **all observed roots before cutoff**,
  including idle/incomplete/abandoned sessions. `activeRoots` separates period
  activity from that cumulative denominator. Children with explicit roots are
  grouped under their root, not independent samples; unknown roots remain visible.
- First observed root/task cohort is retained across windows. Distinct tasks in
  one root can have different cohorts (`mixed` root); cohort root counts then
  overlap and must not be summed as independent samples. Conflicting assignment
  observations for the same root/task are counted, not silently overwritten. Cohorts are configured,
  not randomized. Policy/config versions and provider/model digests are retained
  in strata, not pooled away. Unknown values get explicit buckets.
- Phase durations are explicit start/end wall-clock spans, including compaction
  and waits. Open spans have missing durations. Task duration/completion is
  **unknown** without explicit lifecycle labels; shutdown/reload is not completion.
  Task duration summaries describe the cumulative assigned tasks, while phase,
  attempt, usage and recovery summaries describe the selected observation period.
- `n`, `missing`, median and nearest-rank p90 accompany distributions. Before
  context uses the paired start; after uses the observed terminal context (often
  unknown), not usage totals. Orphan outcomes and unfinished starts remain visible.
- `willRetry` counts retry **signals**, not proof that a retry happened. Recovery
  checks are producer observations, not certified authorization. Useful-action
  latency runs from successful compaction terminal to the first explicitly marked
  successful useful action for that attempt; absent markers stay unknown.
- Repeated checkpoint evidence references are a repeat **proxy**, not proven waste.
  Reread instrumentation is unavailable and reported null. Operation token/cache
  sums include assistant and summarization usage once; zero differs from missing.
  `knownTotal` costs are partial unless `complete` is true; no price is invented.
- The report always returns a non-adoption conclusion: descriptive configured
  cohorts, small samples, missing semantics and unknown coverage do not justify
  rollout. A later measured assessment must supply controlled evidence separately.

Semantic task/phase classes cannot be recovered from digests. Optional `--labels`
accepts an explicitly maintained private JSON object; no raw transcript ingestion:

```json
{
  "tasks": {
    "<task-ID SHA256>": {
      "taskClass": "code",
      "startedAt": "2026-10-16T12:00:00.000Z",
      "completedAt": "2026-10-16T12:05:00.000Z",
      "status": "complete"
    }
  },
  "phases": { "<phase-occurrence SHA256>": "verification" }
}
```

Omit unavailable fields rather than guessing. `status: "abandoned"` explicitly
retains abandoned tasks; absence means incomplete. Labels are observations, not
another authority or cohort store. The existing collector/pilot does not populate
semantic class or task lifecycle labels automatically. Unlabelled reports work
without manual monitoring, with visible unknown class/duration coverage.

## Schedule and rollback (activation instructions, not executed installation)

The existing local scheduler is a systemd **user** timer. Templates are in
[systemd/](systemd/). Its calendar is exactly:

```ini
OnCalendar=Sat *-*-* 09:00:00 America/Los_Angeles
Persistent=true
```

On an authorized activation, point the service's `ExecStart` at the installed
`dist/report.js` (the template assumes `~/.local/share/pi-tasks/`); append explicit
`--telemetry`, `--output` or `--labels` paths if needed. Ensure the user manager
has Node/notify-send and the desktop D-Bus environment. Do not enable lingering
or change login/security policy just to satisfy reporting. Persistent timers catch
up one missed activation after the manager resumes; they do not run while off.

```sh
install -Dm644 docs/systemd/pi-compaction-report.service "$HOME/.config/systemd/user/pi-compaction-report.service"
install -Dm644 docs/systemd/pi-compaction-report.timer "$HOME/.config/systemd/user/pi-compaction-report.timer"
systemctl --user daemon-reload
systemctl --user enable --now pi-compaction-report.timer
systemctl --user start pi-compaction-report.service
systemctl --user status pi-compaction-report.service pi-compaction-report.timer
```

Rollback: `systemctl --user disable --now pi-compaction-report.timer`, stop the
service, remove only those two installed units, then `systemctl --user daemon-reload`.
Keep private history unless deliberately removing it. No telemetry or pilot
configuration is changed. A `.lock` prevents concurrent report writers; after a
killed process, verify no report service/process is running before removing that
empty directory and retrying. Never delete history to work around a delivery error.

Weekly notifications deduplicate by cutoff; concrete mismatch alerts deduplicate
by event-ID/check across periods. Unknown checks never generate concrete-mismatch
alerts. Pending notices are persisted before delivery and marked sent after
acknowledgement. A crash between notification acknowledgement and the sent write
can duplicate a notice on retry (at-least-once transport, not exactly-once).

## Reproducible local exercise

```sh
npx vitest run test/unit/compaction-report.test.ts test/unit/compaction-report-delivery.test.ts
node --experimental-strip-types scripts/report-benchmark.ts
```

The benchmark creates only a uniquely named **transient fixture** user timer with
the real weekly calendar and Persistent flag. It manually triggers the associated
oneshot into a private synthetic input/output directory, then simulates replay
and a missed November window with explicit clock inputs. Its fixture notification
sink persists IDs locally. The timer and fixture directory are removed in `finally`.
No installed pilot, real desktop receipt, daemon restart or causal performance is
proved. See [report-benchmark.json](report-benchmark.json) for the checked run.

## Lifecycle and consumer verification map

| Transition | Producer → consumer | Persisted state / proof |
| --- | --- | --- |
| Startup | systemd oneshot → CLI → TelemetryStore | existing private metadata only; missing-store/permission tests |
| Dispatch | calendar → report → notify-send | LA/DST boundary tests, real transient timer and fixture service |
| Restart/missed window | latest cutoff → history/outbox | catch-up-one fixture; immutable history, pending notice retry |
| Replay | event files → aggregator; outbox → notifier | event dedup, root/child tests, cross-period mismatch dedup |

No cross-service API, trust-material distribution or worker authority changes.
`report.ts` builds to `dist/report.js`; the default Pi extension manifest remains
unchanged. CI runs all `test/unit/` through `scripts/release-check.sh`, plus strict
build/native SDK/import/package checks. The systemd exercise is Linux/user-manager
local verification, not a CI claim about deployed delivery.
