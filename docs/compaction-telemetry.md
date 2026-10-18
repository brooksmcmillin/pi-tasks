# Passive phase and compaction telemetry (v1)

Read on demand:
- Activating or stopping collection: [Load and stop](#load-and-stop).
- Implementing a phase/checkpoint producer: [Producers and correlation](#producers-and-correlation).
- Computing statistics: [Measurements and missingness](#measurements-and-missingness), then [Restart and report consumers](#restart-and-report-consumers).
- Reviewing/testing: [Lifecycle map](#lifecycleconsumer-verification-map) and [Controlled benchmark](#controlled-benchmark).

This opt-in companion collects private metadata, not task authority or memory.
It never calls `compact`, cancels compaction, queues continuation, changes cohort
assignment, or sends content to a service. Policy/recovery automation and reports
are separate consumers (tasks 7678/7679); installation and live verification are
separate work (7680). Nothing is activated by installing the default package.

## Load and stop

Build with `npm run build`, then explicitly load the file:

```sh
pi --extension /absolute/path/to/pi-tasks/dist/telemetry.js
```

The default package manifest still loads only `dist/index.js`. For durable use,
add this exact companion path to Pi's extensions configuration, then reload.
Remove it and reload to stop collection. This document describes activation;
this change does not modify anyone's installed configuration.

Default store: `~/.pi/agent/telemetry/compaction-v1/`. Override it with
`PI_TASKS_TELEMETRY_DIR` before starting Pi. The final directory must be owned by
the current user and private (0700); event files are exclusive-created (0600),
immutable JSON files named by their event-ID digest. Symlink records are not read.
There is no retention daemon: remove the private directory when no collector or
report reader is using it. Do not publish these files; stable digests remain
correlatable and are not anonymization against known-input guessing.

## Producers and correlation

Native `session_start`, `session_shutdown`, `message_end`,
`session_before_compact`, `session_compact` and `session_compact_failed` hooks
collect observations automatically once loaded. Missing hooks on another host
mean missing evidence, not fabricated success. Before/success/failure handlers
return no compaction decisions. Failures produce one generic warning per
collector, without error text, and never block ordinary work.

Phase semantics must be **explicit**, not inferred from task prose or tool names.
A workflow or checkpoint integration emits `pi-tasks:phase` on the existing
`pi.events` bus. This is an observer contract, not a new model tool:

```ts
pi.events.emit("pi-tasks:phase", {
  version: 1,
  id: "stable-workflow-transition-id", // reuse for replay, unique per transition
  kind: "phase_start",
  rootSessionId: rootSessionUuid,
  taskId: taskId,
  phaseId: phaseOccurrenceId, // unique per phase occurrence, not just 'verification'
  policyVersion: "native-baseline-v1",
  configVersion: effectiveConfigurationVersion,
  cohort: "baseline",
});
```

Allowed kinds: `phase_start`, `phase_end`, `checkpoint`, `recovery`,
`useful_action`. Use `phase_end` with the same phase occurrence ID and a distinct
transition ID. Fields omitted on subsequent markers inherit the current
root/task/phase/policy/config/cohort; explicit null clears them. End a phase before
starting the next, including waits if measured. Emit new markers after branch
navigation; the collector never guesses another branch's semantic phase.
No producer is installed that labels investigation/implementation/verification
from text. Uninstrumented workflows have null phase/task/policy and must remain
in reporting denominators.

Checkpoint markers accept `checkpointId`; recovery/useful-action markers accept
`checkpointId`, `evidenceId`, optional `compactionId`, and `outcome`
(`success|failure|abort|unknown`). These references are identifiers of existing
private records, not their contents. A recovery marker's `recovery` object accepts
`identity`, `authority`, `evidence`, `children`, each `pass|mismatch|unknown`;
absent/invalid checks become `unknown`. These are producer observations, not
collector-certified authorization. Emit useful_action only after a successful
action advances the recorded next deliverable; bookkeeping is not automatically
useful. The collector does not infer semantic recovery or authorize execution.

All incoming string IDs, policy/config versions, provider and model values are
SHA-256 digests in storage. Unknown fields and raw strings (including prompts,
responses, tool arguments/results, error messages and authorization prose) are
never serialized. All records include schemaVersion, event id, per-session
sequence, session/root/parent/task/phase/compaction/checkpoint/evidence IDs,
observation timestamp and nullable metadata. Root is the session ID only when a
session header proves no parent; for children it is unknown until explicitly
supplied. A parent-session file reference is hashed, never read recursively.

Native compaction attempts receive a new correlation ID at `before`; the terminal
record carries the same ID and the attempt's original correlation/config/model
snapshot, including explicit unknowns. Terminal current-context samples are still
current observations. Checkpoint references attach to both. Markers without
an explicit compactionId inherit the last observed completed compaction, including
after restart. An explicit compactionId is a producer's raw ID and is hashed; do
not feed an already-hashed ID back as a raw ID. A custom producer may supply a
stable `attemptId` to the before adapter when replaying its own bounded workload;
native Pi does not provide one. Native before/failure notifications are live
attempts, not replayed session entries. An unpaired terminal stays visibly
`missingStart: true`; it is never paired to an old interrupted attempt by guess.

## Measurements and missingness

- `context.tokens` is **current context**, from `getContextUsage` with provenance
  `runtime_estimate`, or `preparation.tokensBefore` with provenance `preparation`.
  Unavailable values, including just after compaction, are null, not zero.
- `usage.scope = operation`: assistant-message or summarization usage only.
  Input/output/cacheRead/cacheWrite/totalTokens and each reported cost component
  are allowlisted finite nonnegative numbers. Missing/invalid values are null;
  genuine zero stays zero. No prices are invented. Do not treat summed usage as
  current context. Usage events and compaction_end are distinct billed operations;
  do not sum compaction_start as usage or double-count replayed events.
- Native compaction config fingerprint covers the observed provider/model and
  resolved reserveTokens/keepRecentTokens. It is **not** a fingerprint of unseen
  memory/thinking/extension settings. Before a compaction or explicit config
  marker, config is unknown. A model change invalidates the previous config
  fingerprint until another observation supplies it. Policy/cohort are never inferred.
- `durationMs` measures the observed compaction before→terminal wall-clock span;
  phase elapsed is phase_start→phase_end timestamps. These include waits. Active
  time and wait attribution are unknown unless a producer explicitly marks them.
- `timestamp` is collection time; `sourceTimestamp` is normalized native compaction
  entry time when supplied. Sequence orders same-millisecond observations within
  a session; wall-clock adjustment can still affect elapsed measurements.

## Restart and report consumers

`TelemetryStore.read()` returns records and an explicit invalidFiles count.
Truncated, oversized, permission-invalid and unreadable files remain on disk and
are counted, never silently repaired or overwritten. Read failures must be shown
as report failures, not empty successful cohorts. `coverage(records)` retains
incomplete attempts, orphan outcomes, open phases and sessions whose latest
persisted observation is not shutdown. Old shutdown does not close later resumed
activity. An idle resume without new observations is unknown; this is not a
process-crash detector. Shutdown means extension teardown (also reload/switch),
**not** task success; consumers must not call a session/task complete from it alone.

Event IDs are deterministic for explicit markers, native successful compaction
entry IDs, assistant timestamp/allowlisted-usage/outcome identities and the initial
session observation. Native `message_end` precedes entry persistence, so the
mutable tree leaf is not used as message identity. Identical timestamps, usage
and outcome are indistinguishable without a native message ID; no content hash
is collected to disambiguate them. Missing timestamp identity is visibly marked
`missingIdentity: true` and not deduplicated by guess. Exclusive
creation and restored IDs prevent duplicates across restart/replay. Replayed old
markers do not roll correlation state backwards. Restart restores last recorded
live correlation metadata, excluding terminal attempt snapshots; it restores
neither authority nor a pending operation. Killed processes keep
starts without ends; never drop them from cohorts or invent durations. Missing
first-useful-action/recovery events remain unknown. Report readers should dedupe
by event ID even when merging copied stores, preserve incomplete/invalid counts,
and group child sessions under an explicitly known root rather than counting
children as independent samples. Digests may be resolved only by an authorized
consumer with the original private identity sources.

## Lifecycle/consumer verification map

| Transition | Producer → consumer | Persisted observation / verification |
| --- | --- | --- |
| Startup | companion → collector | Private directory and session identity; hook fixture |
| Dispatch | native hooks / explicit bus → allowlist | No content or authority; privacy/outcome fixtures |
| Restart/replay | immutable files → collector/reports | IDs, last correlation, incomplete starts; restart/dedup fixtures |
| Shutdown | companion → report coverage | Teardown only; unsubscribe fixture |

No worker dispatch, wait authority, network hop or generated client changes.
Existing task snapshots and `pi-tasks:state`/`pi-tasks:telemetry` remain unchanged.
The existing historical session-auditor Pi adapter consumes full transcript
lifecycle/compaction entries; it does not expose prospective explicit phase/cohort
or recovery markers. Reuse native IDs/usage semantics, not its raw-content store.
The new report consumer can import `TelemetryStore`, `coverage`, and
`TelemetryRecord` from `dist/src/compaction-telemetry.js`; no service is required.

## Controlled benchmark

```sh
node --experimental-strip-types scripts/telemetry-benchmark.ts
```

Five alternating-order on/off rounds construct 1,000 identical synthetic phase
markers per arm. The on arm includes hashing, validation, serialization and
exclusive file writes. Startup and readback are excluded; record counts and
invalidFiles are verified after each round. Temporary private outputs are removed.
Capture stdout as the durable measurement artifact. This is collector overhead
on one machine/filesystem, **not** real-session speed gains or causal evidence for
early compaction. See `telemetry-benchmark.json` for the checked local run.
