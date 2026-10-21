# Checkpoint-backed compaction pilot

Task: https://nexus.brooksmcmillin.com/task/7678

## Opt-in, not activation

The default entrypoint contains the pilot, but takes no action without an explicit
`PI_TASKS_COMPACTION_COHORT=baseline` or `pilot` environment value. Assignment is
persisted once per root Pi task/session in a `pi-tasks:compaction-cohort` entry
when a successful task mutation identifies that task, before waiting for idle.
A metadata-only checkpoint marker binds the passive collector immediately; it is
not a saved recovery checkpoint or a phase boundary. Tasks handed off to review,
blocked or completed in the same turn therefore retain cohort attribution.
Idle settlement remains a fallback for an already-active task. Read-only queries,
failed tools and inactive creation do not assign the previous active task.
Resume and inherited fork entries keep the original cohort despite environment
changes. Different root tasks have independent assignments. This is explicit
cohort selection, not randomization or a causal experiment. Use comparable cohorts.
`PI_TASKS_COMPACTION_DISABLE=1` disables intervention without suppressing mutation-time
attribution or rewriting assignments. Attribution alone never compacts or arms a
recovery continuation. Load the companion from session start to capture markers;
existing unknown historical records are not retroactively relabeled.
No installed configuration, model, memory policy or extension is changed here.
Load the [passive telemetry companion](compaction-telemetry.md) to collect records.

## Native scheduling and retention

For a large model, eligibility starts at 100,000 current-context tokens. An explicit
phase boundary targets 125,000; fallback requests compaction from 150,000 at the
next safe idle boundary. Successful `task_verify_step`, a batch containing step
verification, `task_checkpoint`, or a v1 `pi-tasks:phase` `phase_end` marker naming
the current task records an explicit boundary. No conversational text is parsed.

The installed Pi 1.3.0 `ctx.compact()` invokes manual native compaction and aborts
an active operation. Therefore this implementation requests it only from
`agent_settled` with `ctx.isIdle() === true`, no pending input and no observed live
child. It does **not** interrupt a running tool batch or promise an immediate
in-run trigger at 150k. Native between-turn threshold and overflow protection
remain responsible before the run reaches that idle boundary. Small models clamp
fallback to `min(150k, window - 40k)`, target to `min(125k, fallback * 5/6)` and
eligibility to `min(100k, target * 4/5)`. Windows at or below 40k defer to native.

The pilot neither changes native settings nor supplies a replacement summary.
Its own `session_before_compact` attempt requires effective
`preparation.settings.keepRecentTokens === 20000`; otherwise only that pilot
attempt is cancelled and logged as `retention-mismatch`. Ordinary manual,
threshold and overflow compaction are never cancelled by this policy. Native
summarization, cut selection and configured response reserves are unchanged.

## Checkpoint and scoped recovery

The existing task snapshot continues to retain the full task contract. A bounded
private session observation (`pi-tasks:compaction-checkpoint`, at most 64 KiB)
links the exact active task/step/revision to:

- actual Git worktree root, attached branch and HEAD;
- a dirty-state digest covering status, tracked working/index diffs and untracked
  contents or symlink identity (not a backup or publication checkpoint);
- PR/head/source references, child run IDs, unresolved decisions/gates and tested
  heads from existing handoff lanes;
- user session-entry and user-decision source references, allowed operations,
  evidence/artifact references, and the exact recorded next action.

Missing task/step/revision, repository identity, user-source identity, oversized
state or unreadable dirty content skips pilot intervention, not native recovery.
Unbound evidence/tested heads and absent PR observations stay explicitly unknown;
no external observation or permission is fabricated. Non-Git work currently
remains on native compaction. Keep durable dirty patches through the owning
repository workflow; the digest cannot reconstruct lost files.

`task_resume()` exposes the checkpoint only for the same active task and computes
identity `pass/mismatch/unknown` against current task/repository observations.
Each evidence record is checked independently; a revision mismatch does not erase
other evidence. PR observations and existing child status require fresh owner-tool
reads. Optional `recovery` input compares those observations for one operation:

```json
{
  "recovery": {
    "operation": "task_verify_step",
    "authorizationSource": "session-entry:<original-user-entry-id>",
    "authorizationRevision": "<current-exact-task-revision>",
    "prHeads": [{ "url": "<PR URL>", "head": "<fresh-published-head>" }],
    "children": [{ "runId": "<existing-run>", "status": "running" }]
  }
}
```

These are caller-supplied observations from fresh checks, **not capabilities or
independently authenticated attestations**. An authority comparison passes only
for an operation retained by both contracts, the same task revision, no unresolved
gate, and matching source/revision references. It always returns
`authorityGranted: false`. Missing checks are unknown; stale scope/revision/source
is mismatch. The controller must stop the affected unauthorized action, not
unrelated safe work. This is not an interceptor for other tools. Never relaunch
an unobserved child, infer that a missing run is terminal, or regain a lease from
checkpoint data. Operation ownership and security gates keep their existing tools.

## Continuation ownership

Only a successful **pilot-owned** idle manual compaction can request one hidden
`task_resume` follow-up. It requires a successful task execution mutation in the
current input, unchanged identity, active/unblocked task, no pending input or live
child, and no intervening input/tree/session change. Read-only recovery and
checkpoint bookkeeping alone cannot arm continuation. A repeated callback,
failed compaction, cancellation, user stop or shutdown cannot request a turn.
Unrelated manual compaction stays non-resuming. Threshold continuation stays with
the installed continuation extension; overflow retry stays with Pi. No child
launch or action is executed by recovery itself.

Telemetry uses existing phase/checkpoint/recovery markers. Additive allowlisted
`policyDecision` values expose actual triggers and deferrals while older v1 records
remain readable. Identifiers/references remain hashed by the companion. Telemetry
errors cannot change ordinary task execution. Runtime activation and measurement
belong to tasks 7680/7681, not this code deliverable.

## Controlled recovery replay

```bash
PI_SDK_ROOT=/path/to/pi-coding-agent \
PI_THRESHOLD_CONTINUATION_EXTENSION=/path/to/resume-after-threshold-compaction.ts \
npm run test:native -- -t 'native compaction recovery replay benchmark'
```

Without the second variable the test uses the pinned local continuation fixture.
The replay uses real native extension loading, argument validation, session
snapshots, lifecycle dispatch and the installed context callback path, with a
synthetic compaction transport and captured message sends. It checks manual (zero
extension continuations), threshold (one installed-consumer message), overflow
(zero extra messages; native retry remains the owner), failure (zero), and pilot
(one recovery follow-up). Exact next-action continuity, recovery verdicts and
telemetry are asserted. It does not call a paid provider, measure semantic summary
quality or prove live scheduler behavior. Unit fixtures additionally cover cohort
resume/fork inheritance, thresholds, unknown state, retention, stale authority,
affected evidence, dirty state and child/PR observations. This is controlled local
replay evidence, not perfect semantic recovery or deployed performance.
