# pi-tasks

> Pi-native execution contracts for AI agents — no more "trust me, it's done."

## Why pi-tasks?

AI coding agents say "done" without proof. Context compaction loses progress. Multi-step work drifts without anyone noticing. You end up asking "what's the status?" over and over.

**pi-tasks** gives your Pi agent a binding execution contract: structured plans, evidence gates, ordered execution, and compaction-safe resume — all visible in your TUI.

## Optional passive telemetry

An opt-in companion records private phase/compaction metadata without changing
compaction policy or collecting content. It is not loaded by default. See the
[telemetry contract and local benchmark](docs/compaction-telemetry.md) for loading,
producer markers, privacy, missingness and report integration.

## Optional checkpoint-backed compaction pilot

Set `PI_TASKS_COMPACTION_COHORT=baseline` or `pilot` to persist an explicit cohort
for each root task/session. Pilot sessions request native compaction at safe idle
phase boundaries around 125k current-context tokens (150k fallback), retain the
native 20k recent-token policy, and expose scoped checkpoint recovery through
`task_resume`. Native overflow recovery remains untouched. No cohort is enabled
by default, and this does not activate a local rollout. See the
[pilot contract and controlled replay](docs/compaction-pilot.md) for smaller-model
limits, native scheduling constraints, fresh authority checks and rollback.

## Optional private weekly reports

`node dist/report.js` compares baseline/pilot telemetry with duration distributions,
recovery checks, usage/cost availability and incomplete/unknown denominators.
An opt-in systemd user timer runs Saturday 09:00 America/Los_Angeles with private
history and deduplicated desktop mismatch notifications. No timer is installed
by the package. See [reporting, fixture exercise and rollback](docs/compaction-report.md).

## What makes it different

pi-tasks focuses on three enforced execution contracts:

| Contract | What it means |
| ---------- | --------------- |
| **Evidence-gated completion** | Agents cannot mark work done without traceable, reproducible proof |
| **Atomic step decomposition** | Vague or compound steps are rejected; non-atomic steps must be broken down before execution |
| **Compaction-safe resume** | Context window limits don't lose your progress — snapshot replay picks up exactly where you left off |

Plus: ordered step execution, scope drift detection, weak-model recovery guidance, decision/blocker audit trails, and branch-aware persistence.

## Competitive landscape

Different tools solve different parts of the agentic workflow. Pick based on what matters most to your team:

| Tool | Focus | Strengths | Trade-offs |
| ------ | ------- | ----------- | ------------ |
| **Claude Code Tasks** (built-in) | Cross-session coordination | Shared task lists, dependency tracking, zero setup | No completion verification, no step-level contracts |
| **[rpiv-pi](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-pi)** | Structured workflows | 4 pipelines, 30 skills, 15 subagents, detached reviewable stages | Workflow-oriented; task visibility comes from sibling rpiv-todo |
| **[@tintinweb/pi-tasks](https://github.com/tintinweb/pi-tasks)** | Task tracking & subagents | Dependency DAG, auto-cascade, file/session/project scoping | Tracks progress; completion is self-reported |
| **[Microsoft hve-core](https://github.com/microsoft/hve-core)** | RPI workflow for Copilot | Research→Plan→Implement→Review, custom agents | Copilot-native; not designed for Pi |
| **pi-tasks** (this project) | Execution contracts | Evidence-gated completion, atomic decomposition, compaction-safe resume | Narrower scope; no subagent orchestration (yet) |

**pi-tasks is for you if** your core problem is agents claiming "done" without proof, plans drifting mid-execution, or context compaction losing progress. If you need workflow orchestration or multi-agent coordination, the tools above may be a better fit — or complement pi-tasks.

## Install

### npm package

For Pi:

```sh
pi install npm:pi-tasks
```

For Oh My Pi:

```sh
omp plugin install npm:pi-tasks
```

`omp install pi-tasks` is an equivalent shorthand. OMP's `--scope project`
applies to marketplace references such as `name@marketplace`; npm package
specifications remain user-scoped.

### Local checkout

Build before registering a checkout so its tracked `dist/` matches the source:

```sh
cd /path/to/pi-tasks
npm ci
npm run typecheck
npm test
npm run build

# Register with the host you use:
pi install ./
omp plugin link "$(pwd)"
```

Use either the npm package or the local checkout for a host, not both. Check
Pi with `pi list` and OMP with `omp plugin list --json` when switching sources.

## Upgrade

### npm-installed package

Update only pi-tasks in Pi:

```sh
pi update npm:pi-tasks
pi list
```

Use `pi update --extensions` instead when every installed Pi extension should
be updated.

Update only pi-tasks in OMP:

```sh
omp plugin upgrade pi-tasks
omp plugin list --json
omp plugin doctor
```

Bare `omp plugin upgrade` and `omp update --plugins --check` report marketplace
plugin status; they do not confirm that this npm plugin was upgraded.

Install the unversioned Pi source (`npm:pi-tasks`) to follow the npm `latest`
tag. Pi preserves explicitly versioned sources such as
`npm:pi-tasks@<version>`. To remove a pin:

1. Run `pi list`.
2. Pass the exact pinned source shown there to `pi remove`.
3. Run `pi install npm:pi-tasks`.

### Local checkout

A linked checkout is updated from Git, not from the npm registry. Finish,
commit, or stash local edits before pulling. Exit Pi and OMP processes that use
the checkout before replacing dependencies or build output.

```sh
cd /path/to/pi-tasks
git status --short
git pull --ff-only  # only when the checkout is clean and follows a remote branch
npm ci
npm run typecheck
npm test
npm run build
```

When actively developing local changes, skip `git pull --ff-only` and build the
current tree. The manifest loads `dist/index.js`, so source edits are inactive
until the build succeeds. The local registration only needs to be repeated when
its path or host settings change.

Pi and OMP load extension modules once per process. Start a new host process
after a successful registry upgrade or local build. Then use `pi list` to
confirm Pi's selected source, or `omp plugin list --json` to confirm OMP's
installed version and path.

## How it works

```
task_plan → ordered steps with acceptance criteria
    ↓
task_focus → agent sees exactly what's in scope
    ↓
task_update → record progress, scope changes, blockers, or skips
    ↓
task_verify_step → atomically attach passing proof and advance
    ↓
task_complete → only succeeds when all gates pass
```

`task_plan` creates criterion IDs only after receiving the call. To link initial
steps selectively, use `criterionRefs` as 1-based positions in
`acceptance_criteria`; omitted references preserve the default of linking all
criteria. For example, with two criteria, a step using `criterionRefs: [2]`
links to the second criterion without predicting its generated ID. This
creation-only reference is resolved to persisted criterion IDs atomically. The
sanitized operation-count example can be replayed with
`node --experimental-strip-types scripts/criterion-link-replay.ts`.

Fresh sessions expose only `task_plan` and `task_resume`; after a persisted task is created or restored, pi-tasks activates the available task controls. Explicit Pi tool allowlists, exclusions, and `noTools` remain ceilings, and unrelated active tools are preserved. The user gets `/tasks`. Everything persists in Pi's session tree.

### Oh My Pi support

Oh My Pi discovers extension packages through the same manifest shape:

```json
{
  "pi": {
    "extensions": ["./dist/index.js"]
  }
}
```

No separate `omp` manifest is required. `pi-tasks` uses the Pi-native APIs that
Oh My Pi exposes: `registerTool`, `registerCommand`, `appendEntry`,
`ctx.sessionManager.getBranch()`, `ctx.ui.setStatus`, `ctx.ui.setWidget`, and
the `session_start`, `session_tree`, and `session_before_compact` lifecycle
events.

Because Oh My Pi renders model-facing tool guidance from `description` and
`parameters`, the initial `task_plan` and `task_resume` entrypoints mirror
their critical guidance into descriptions. Lazily activated controls keep only
compact descriptions so native Pi can add them without active-only prompt
metadata.

### Native semantic assessment

Planning, decomposition, replan/rework, current-step classification, and passing
evidence (including batch and verify-step tools) use the host's native model
boundary to judge meaning in the source language. pi-tasks prefers
Pi classifier models, falls back to Pi's structured `modelRegistry.streamSimple()`,
and uses Oh My Pi's `runEphemeralTurn()` when Pi model APIs are unavailable. It
does not ship a provider SDK or call an external model endpoint directly.

The assessor handles English, Traditional and Simplified Chinese, Japanese,
Korean, and mixed technical text under one language-neutral policy. It judges
whether operations are independently executable or verifiable; a conjunction,
filename, keyword, or text length is never sufficient by itself. Task and
evidence fields are quoted as untrusted data, and typed model output is validated
before persistence.

Successful results are stored in version 2 task events with their input hash,
model provenance, prompt version, confidence, and decision. Replay, resume,
branch navigation, rendering, and completion remain deterministic and never
re-run inference. Existing version 1 sessions continue to replay as legacy
history.

Semantic calls consume model tokens and can add latency. Pi classifier/chat calls
send only the assessment payload. Oh My Pi ephemeral turns may include the
current conversation snapshot according to the host's side-turn contract; use
the same data-handling policy as the active OMP conversation. If all native
boundaries are unavailable or return invalid output, the mutation fails closed
with a retry instead of reverting to regex heuristics.

On `session_start` and `session_tree`, pi-tasks performs a static capability
preflight. It inspects Pi classifier metadata and the presence of Pi chat or OMP
ephemeral APIs without sending a model request. Healthy sessions stay silent. If
no native assessor is available, a deduplicated warning and
`pi-tasks-semantic` status direct the user to `/tasks doctor` before a protected
mutation can fail.

`/tasks doctor` displays the three-strategy capability matrix without inference.
`/tasks doctor live` is an explicit opt-in synthetic assessment that reports the
actual strategy, provider, model, latency, and token usage when the host returns
it. The probe does not read or mutate task state. Under Oh My Pi, the host may
still include the current conversation snapshot under its side-turn contract.

## Agent Tools

| Tool | Purpose |
| ------ | --------- |
| `task_plan` | Create a task with objectives, criteria, and ordered steps |
| `task_next` | One-step guidance for weak/small-context models |
| `task_focus` | What work is in scope right now |
| `task_resume` | Recover state after compaction or session switch |
| `task_checkpoint` | Save a durable snapshot and optional orchestration handoff for compaction resilience |
| `task_granularity_check` | Verify a step is truly atomic |
| `task_decompose` | Break non-atomic steps into child steps |
| `task_rework` | Record findings and add remediation, optionally before an open gate, including reopening done tasks |
| `task_replan` | Replace explicitly named mistaken open steps without discarding history |
| `task_list` | List tasks with optional filtering |
| `task_update` | Advance steps, record activity, flag scope drift |
| `task_evidence` | Attach acceptance or diagnostic evidence and supersede linked failures |
| `task_evidence_batch` | Submit bounded evidence records or step verification as one all-or-nothing transaction |
| `task_verify_step` | Atomically attach passing evidence and complete the current atomic step |
| `task_decision` | Record explicit user decisions |
| `task_complete` | Close a task (only if all gates pass) |

## Orchestration handoff across compaction

`task_checkpoint({ handoff: [...] })` replaces the active task's compact handoff
lanes in its existing branch-local session snapshot. Omit `handoff` to preserve
it; use `[]` to clear it. Automatic compaction snapshots retain it. No additional
state store, child launcher, or ownership registry is created.

Each lane records `taskId` (the external task ID, not a mapping to a Pi task),
`cwd`, `branch`, `base`, `head`, `ownershipBoundary`, `publicationBoundary`, and
`nextAction`. Optional fields are `worker: { runId, sessionId, missionId? }`,
`lastVerifiedGate: { name, head, reference }`, `pendingDecision`, and
`pr: { url, head, reference }`. Keep actual identities and references to existing
mission/output/receipt artifacts, not copied reports. For non-Git work, explicitly
record `not-applicable` in ref fields. Limit: eight lanes, 1024 characters per
string, 16 KiB total; oversized checkpoints fail without persisting.

`task_resume` returns these records in `handoff.lanes`, with `authority: "none"`,
`revalidationRequired: true`, and a recovery action before the recorded next
action. It never treats a matching stored SHA or a successful receipt as fresh
proof. The parent must check current task/worktree registration, cwd, refs,
writer ownership, exact run/mission status, publication permission, and PR/head
and gate evidence using their owning tools. Unknown child status blocks a
replacement; do not assume an unobserved run has stopped. A recorded pending
decision does not itself create a wait: use `task_update`'s existing blocker
contract for an unresolved decision or asynchronous wait.

This is a bounded recovery contract, not a Git/PR verifier or an execution
interceptor. It cannot prevent another tool from bypassing its instructions.
Replay can recover historical context after a process restart or branch/fork,
but does not restore live ownership, reattach children, or grant unattended
restart/automatic reclaim. Receipts never grant execution or publication authority.

## Insert review remediation before a gate

Use `task_rework` for findings within the existing objective. Set optional
`before_step_id` to insert ordered repairs before a named open review/publication
step in one operation. Omit it to retain ordinary append behavior.

```json
{
  "task_id": "T1",
  "reason": "Review found a generated contract mismatch",
  "before_step_id": "T1-S2",
  "plan_steps": [{
    "text": "Repair generated cursor contract",
    "expectedOutput": "Generated cursor contract matches runtime",
    "allowedActions": ["edit"],
    "decompositionStatus": "needs_breakdown"
  }]
}
```

The original gate keeps its ID and verification obligations. Earlier open work
stays earlier; when repairs become current, the old active gate becomes pending.
New IDs follow the highest root ID, not their position. Nonexistent, completed,
skipped targets and invalid repairs are rejected without persisting any change.
History, evidence, decisions and blockers remain. Affected criteria need fresh
passing acceptance evidence; failures still require explicit supersession.

The sanitized generated-contract and failed-hook fixtures in
`test/unit/rework.test.ts` compare one insertion mutation with the previous
append-plus-replan sequence (two mutations), asserting equivalent remaining
obligations without retaining private transcripts. This is a local operation-count
benchmark, not a runtime latency or production measurement.

## Compact remediation authoring

For one bounded remediation, supply `remediation` instead of `reason` and
`plan_steps` (never both). The four required fields record the finding, observable
deliverable, owned scope/exclusions, and verification procedure:

```json
{
  "task_id": "T1",
  "before_step_id": "T1-S2",
  "remediation": {
    "finding": "Review found the trust root reference still shares private-key material",
    "deliverable": "Reference a CA-only trust Secret and test its exact name",
    "boundedScope": "Only the backend trust reference and its focused assertion; exclude private keys and cluster changes",
    "verification": "Run the focused trust-reference regression test and confirm the CA-only Secret name",
    "atomic": true,
    "criterionIds": ["T1-AC1"]
  }
}
```

`atomic: true` is an optional caller attestation, not an authority to execute.
The native model assesses every normalized remediation step and determines
`atomic` versus `needs_breakdown` independently of the attestation. Separate
unrelated outcomes into detailed steps rather than asserting atomicity.

Normalization derives only the ordinary evidence-required deliverable step,
two actions bounded by the supplied scope/verification, and flags from that
explicit attestation. It does not invent evidence, finish work, resolve failures,
or select a gate. `boundedScope` and `verification` require 12–500 characters;
`deliverable` requires at least 12. Optional `criterionIds` names existing criteria;
omitting it links all criteria. Closed/unknown insertion targets return available
open IDs and require an explicit correction; they never silently append. Existing
detailed inputs and persisted events remain compatible.

The README example and sanitized historical fixtures are exercised through Pi's
real argument validation and the same tool/reducer used in execution:

```bash
PI_SDK_ROOT=/path/to/pi-coding-agent npm run test:native -- -t 'compact remediation native'
```

The local fixture benchmark compares serialized UTF-8 input bytes and actual
validation/tool attempts (four-action rejection, missing-output rejection,
then valid detailed input versus one valid compact call). Equivalent criteria,
scope, verification and evidence/atomicity obligations are asserted. Closed-target
rejection remains one call for either format. This is a controlled recovery
comparison, not model performance, elapsed time, or a claim that all 19 historical
rework calls were unnecessary. With native-model granularity, the current fixture's
compact form is 745 bytes versus 744 bytes for detailed input; it is not a byte-size
reduction. The example still exercises fewer controlled recovery attempts.

## Repairing a mistaken plan

Use `task_replan` for a planning mistake, not `task_rework` (which adds
findings-driven remediation without replacing existing steps). For example, replace an inspection-only step or duplicate
open steps with the actual deliverable:

```json
{
  "task_id": "T1",
  "step_ids": ["T1-S1"],
  "reason": "Inspection is support work, not a deliverable",
  "plan_steps": [{
    "text": "Rename the Grafana token setting",
    "expectedOutput": "Settings bind the deployed environment variable",
    "allowedActions": ["edit"]
  }]
}
```

Replacements occupy the earliest replaced position. Retired steps remain visible
with `supersededBy` links; their IDs are never reused. Replacement steps must
cover all replaced criterion links and pass the ordinary evidence gates.
Existing evidence, failures, criteria, decisions, blockers, and history remain.
Replan cannot reopen terminal tasks, resolve blockers, or displace another active
task. It does not turn already performed work into verified completion: attach
its real evidence to the corrected steps instead.

New plans require non-empty structured `plan_steps`, not `initial_steps` strings.
All planning tools share a step schema requiring one to three `allowedActions`.
Pure read/inspection mechanics are rejected when authoring plans; old persisted
inspection plans still replay for repair. This is an authoring wording check,
not a natural-language proof of atomicity: an `Inspect` step must name an explicit
purpose (`to verify`, `to validate`, `to confirm`, `to analyze`, `to summarize`, or
`to check`), regardless of object length or words such as `test` in the object.
The existing quality and evidence gates still apply to substantive deliverables. When `task_update` rejects a missing scope
`activity` or cancellation `reason`, recovery points back to `task_update` and
prints the required parameters.

## Classify an already-simple step

An unclassified step is not necessarily compound. Use `task_update` with its
current `step_id` and `step_granularity_check` (a concrete reason and all five
atomicity flags true) to request native-model classification in place. The request
fails if the model does not assess it as atomic. Its ID, criteria, evidence links,
and completion requirements remain unchanged. Classification does not perform
or verify the work, and cannot be bundled with status/evidence updates.

Plan bounded deliverables, not separate support reads, staging commands, or
receipt bookkeeping. Keep those mechanics within the deliverable's allowed
execution. If a step genuinely contains multiple outputs or independent work,
use `task_decompose`; do not assert atomicity just to avoid the gate.

## Cohesive deliverables and batch evidence

An atomic step may represent one independently verifiable outcome rather than one
mechanical edit. Describe its bounded scope and focused verification in the step;
the native assessor treats a cohesive implementation-plus-test cycle as one unit,
without granting unrelated deliverables an atomic exemption. For example:

```json
{
  "text": "Implement parser aliases and focused regression tests",
  "expectedOutput": "Parser alias normalization preserves existing inputs",
  "allowedActions": ["edit parser and tests", "run focused parser tests"],
  "evidenceRequired": true
}
```

These fields describe the execution contract, not proof of atomicity or completion.
Independent outcomes still require decomposition. Legacy persisted granularity
remains replayable; new authoring uses persisted native-model assessments.

`task_evidence_batch` accepts one task and 1–16 ordered entries within 32,000
serialized characters. Each entry uses the `task_evidence` fields (without
`task_id`) plus `operation: "record"` or `"verify_step"`. For `verify_step`,
provide `step_id`, `passed: "true"` and acceptance role; omit record-only
`step_ids`, `override_reason`, `supersedes_evidence_ids` and `reason`.
Record all required checks before the final verification entry advances a step.
Existing criterion linkage, step locks, failed-evidence supersession and completion
gates apply unchanged. All entries persist in one event or none persist; errors
name the rejected entry. Fix that entry and resubmit the entire batch.

```json
{
  "task_id": "T1",
  "entries": [{
    "operation": "verify_step",
    "step_id": "T1-S1",
    "type": "test",
    "level": "unit_test",
    "summary": "Parser suite passed 4 tests",
    "passed": "true",
    "references": ["npm test -- parser"],
    "quality": {
      "source": "vitest",
      "reproducible": true,
      "verifier": "tool",
      "command": "npm test -- parser",
      "artifactRefs": ["npm test -- parser"],
      "observedOutput": "4 tests passed"
    }
  }]
}
```

Every quality field is required, including a nonempty `artifactRefs` array for
every evidence type. Exact command or verification-action references are
accepted. A missing artifact does not
require rerunning successful verification: recovery fills artifact references
from the existing references. Evidence recovery examples are **unvalidated retry
templates**, marked `retry_example_status: "requires_edit"` with `required_edits`
naming the unresolved rejection. Fix those fields and any placeholders before
retrying; copied values are not a claim of validity. For an overlong summary,
write a concise observed result using the existing artifacts. For diagnostic
supersession, explicitly remove the diagnostic target (and remove `reason` if
no supersession targets remain); retain any failing acceptance targets and their
reason. Do not invent observations or change diagnostic records into acceptance.
Save long commands and output in an artifact, link it, and use a short reference
in `command` (maximum 300 characters).
Failed or diagnostic records remain visible; neither can verify a step.

## Review remediation

An exhausted plan is not proof that implementation is complete. When review finds
missing or defective work within the original objective, use `task_rework` instead
of force-completing or asking permission just to extend the plan. Genuine scope or
architecture choices still need an explicit `task_decision`; rework does not grant
approval or resolve blockers.

```json
{
  "task_id": "T1",
  "reason": "Final review found replication progress advancing past a failed record",
  "plan_steps": [{
    "text": "Guard replication progress after record failure",
    "expectedOutput": "Failed batches retain the previous replication cursor",
    "allowedActions": ["task_decompose"],
    "evidenceRequired": true,
    "decompositionStatus": "needs_breakdown"
  }]
}
```

`plan_steps` uses the same contracts as `task_plan`. Omit `criterionIds` to
re-verify all criteria, or specify affected existing criterion IDs. New root step
IDs follow existing roots, including decomposed ones. Existing open work stays
first; the first new step becomes current when the old plan is exhausted.

Rework retains prior steps, evidence links, findings, decisions, blockers, and
warnings. It resets affected criteria to pending, clears completion metadata and
confidence, and recalculates progress. Affected criteria require **new passing
acceptance evidence recorded after rework**. Relinking old proof, including an
identical deduplicated record, cannot re-verify them; describe the observed rerun
distinctly. Failed acceptance evidence still needs explicit passing supersession.

`task_next`, `task_resume`, and `task_focus` expose rework even when completion is
recommended or no open step remains with verification gaps. If no task is active,
use `task_list` (`include_done: true` for completed tasks) to recover its ID.
Rework can reopen a done task but cannot reopen a cancelled task or silently
displace another active task. No prior session entries are rewritten.

## Advisory yield check

After successful task execution calls (`task_plan`, `task_decompose`,
`task_rework`, `task_replan`, `task_update`, `task_evidence`, `task_evidence_batch`,
or `task_verify_step`), a normal settlement boundary can request **one advisory
continuation per input** if the same task is still active with an open step and no
unresolved blocker. The check reads current state after queued work, rather than
leaving a follow-up in the queue at `turn_end`. It reuses the compact resume
recommendation: an unrun review or validation is a next action, not itself
an external blocker. The agent must still respect the user's current request and
all review, permission, and verification requirements.

This is not a completion gate or a guarantee of autonomous completion. It never
requires a PR, marks a task complete, blocks tools, or repeatedly restarts the
agent. Read-only task queries, checkpoint/decision calls alone, unrelated answers,
blocked/review/terminal tasks, exhausted plans, abnormal stops, cancellation, and
queued messages or already-requested continuations do not trigger it. New input
and session replay clear prior task engagement; a stale active task alone cannot restart work. Execution calls are
bound to their explicit target, or the result of an activating `task_plan`;
creating an inactive task never engages a different active task. Consequently, work that
does not call an execution tool in that input is deliberately outside its scope.

Record a genuine decision wait or external obstacle with `task_update`'s blocker
fields (reason, `blockedBy`, and `neededToUnblock`); `task_decision` records a choice,
not an unresolved wait. The advisory explicitly permits human decisions, user
redirection, explanation-only requests, and waiting for asynchronous results.
Live pi-subagents runs announced through `subagent:async-started` suppress the
advisory until their matching `subagent:async-complete` events arrive. Events from
other sessions are ignored. This requires event subscriptions and session identity;
it does not recover runs started before subscription or detect other asynchronous
providers. Record those waits explicitly. Hosts without `agent_before_settle`
retain task functionality without automatic advisories.

### Optional named-task pickup coordination

When the infra named-task pickup guard is loaded, pi-tasks consumes its
`task-continuation:ownership` **v1** event. A handled pickup, pending async work,
or exhausted pickup budget suppresses the pi-tasks advisory. Once pickup takes
ownership, pi-tasks relinquishes its advisory for that input, even if pickup later
reports `stop` or `complete`. Pickup owns the one recovery nudge and its bounded
stall diagnostic; pi-tasks does not start another loop after `task_plan`.
Order-independent coordination requires the producer's additive
`recovery: { inputId, owned }` metadata. The producer persists ownership for that
input even after async completion, including completion between extension
handlers. pi-tasks reads it directly; only a new producer input/checkpoint can
replace it. Older v1 producers remain best-effort and cannot guarantee safety
across reset/inter-handler races. Update both extensions for the full contract;
merging source does not activate an already running runtime.

The workflow must register `task_pickup` **before** readiness or Pi plan work and
update its explicit blocker/decision/wait/complete/stop disposition. Pi task IDs
and external pickup IDs are separate; this consumer neither maps IDs nor changes
TaskManager lifecycle. It does not infer pickup completion or obstacles from Pi
task state or prose. A pickup registered only after a standalone pi-tasks nudge
cannot retroactively share that spent budget under this one-way v1 contract.

No infra runtime dependency is required. Without a producer, ordinary pi-tasks
advisories remain available. Malformed, other-owner and unsupported-version
publications are ignored (and cannot erase a previously valid ownership state);
present malformed recovery metadata is never downgraded to legacy v1. Reload/tree
replay restores the producer's
branch-local budget, including exhaustion; status reads and repeated pickup
signals do not refill it. See the [pinned offline replay evidence](https://github.com/brooksmcmillin/pi-tasks/tree/main/test/fixtures/infra-task-continuation).

To disable pickup recovery, exclude `extensions/task-continuation/index.ts` in
project `.pi/settings.json` with a leading `-`, then `/reload`. That leaves the
standalone pi-tasks advisory enabled. To disable both, also disable pi-tasks via
`pi config` resource selection (or remove its explicit extension/package entry)
and `/reload`; task tools from pi-tasks will then be unavailable. No new recovery
configuration or manual sign-off is required.

## Recovery contracts

- Decomposition stops at depth 4. A still-non-atomic step then recommends an explicit `task_update` blocker so its remaining scope can be planned as a flat successor; pi-tasks never marks it done or creates the successor automatically.
- Evidence fields expose the same limits enforced by the reducer: summaries 500 characters, observed output 1,000, and each reference/source/command 300. Retry templates preserve valid values and replace invalid over-limit values with explicit placeholders.
- `task_update.scope` requires `activity`; `scope_change` and `off_plan` also require `scope_reason`. Missing fields return a targeted `task_update` recovery using the public snake_case parameter names.
- Empty or omitted `criterionIds` on new and decomposed steps auto-link the available task criteria; non-empty arrays must contain known generated IDs.
- Plan, decomposition, replan, and rework quality is assessed through the native Pi/OMP model boundary. Plan schemas do not accept caller-supplied granularity scores; bounded `allowedActions` remain required guidance.
- Current-step classification also requires a native assessment; caller flags cannot override the model. Passing evidence uses the same assessment boundary through `task_evidence`, `task_verify_step`, and `task_evidence_batch`.
- Assessment failures are fail-closed and retryable. Rejected calls persist nothing, consume no task/evidence IDs, and never fall back to keyword regexes.

## Completion Gates

`task_complete` rejects when:

- No evidence exists
- Any ordered plan step is still active or pending
- Required criteria are not satisfied
- A criterion is satisfied without active acceptance evidence
- A completed evidence-required step lacks evidence
- A completed step or satisfied criterion has a non-superseded failing acceptance record
- Completion evidence contains no active acceptance record
- Unresolved blockers remain
- Unresolved scope drift warnings remain
- All evidence is only `not_verified`

Forced completion requires `force_with_reason` and produces a low-confidence warning.

### Evidence roles and supersession

Evidence defaults to `role: "acceptance"` for backward compatibility. Use
`role: "diagnostic"` for expected or remediated fail-first observations. Diagnostic
evidence remains visible, may be linked for context, and may support a diagnostic
step, but it does not change or satisfy acceptance criteria and cannot count as
task-completion evidence. Link passing acceptance evidence to the relevant
criteria and use it for task completion.

```json
{
  "role": "diagnostic",
  "passed": "false",
  "summary": "Fail-first test produced the expected failure"
}
```

If failing acceptance evidence is already linked, a passing acceptance replacement
can explicitly supersede it:

```json
{
  "supersedes_evidence_ids": ["E239"],
  "reason": "Passing rerun after formatting"
}
```

The original record remains visible as `superseded by:E240`; the replacement
shows `supersedes:E239` and the reason. Only an explicit passing acceptance
replacement with a non-empty reason removes that failure from completion
validation. Diagnostic evidence cannot supersede acceptance failures, and a later
pass never implicitly supersedes earlier failures.

### Long verification commands

`quality.command` accepts at most 300 characters. If the original command is
longer, save that exact command and its observed output in an artifact, reference
that artifact briefly in `quality.command`, and include its path in
`quality.artifactRefs`. Do not weaken, shorten, or rerun a successful check merely
to fit the evidence field. Recovery examples contain placeholders to fill with
real artifact paths, not evidence that an artifact already exists.

Reasoned skipped steps, including legacy session entries without `supersededBy`,
do not require execution evidence. Skipping does not satisfy acceptance criteria
or erase linked failures; those still require ordinary verification.

## Token Efficiency

Routine successful mutations return a compact receipt: affected task/step identity,
status, permitted next actions, prohibited tools, and newly relevant constraints.
Changed execution contracts are included; unchanged lineage and recovery templates
are not repeated. First use, replay/automatic compaction recovery, and errors retain
full guidance. Explicit `task_resume` and `task_focus` remain authoritative, and
structured resume details are preserved. Blocking a task still reports its blocker
without changing which task is active. See the [sanitized receipt benchmark](docs/receipt-benchmark.md)
for a reproducible local payload comparison; model-time impact is unknown.

Routine resume/next/focus results and their resume details summarize at most five
verification gaps, three blockers, and three warnings, with explicit omitted
counts and a full-history recovery instruction. Actionable scope/replay warnings
come before recent historical warnings. Execution decisions still use the full
state: summarization never makes a blocked or unverified task complete.
Current-step execution parameters remain intact rather than truncating IDs.
Retrieve the complete retained history with `task_list({ include_history: true })`.

```text
# Compact defaults during work:
task_next
task_resume
/tasks

# Detailed view only when debugging:
/tasks detail
task_list include_evidence=true
```

## Custom task UI

pi-tasks publishes a versioned compact task context after restoring its default
widget and after every successful task mutation. Other Pi extensions can subscribe
without importing or patching pi-tasks internals:

```ts
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  TASK_STATE_EVENT,
  type TaskStateEvent,
} from "pi-tasks";

export default function customTaskUi(pi: ExtensionAPI) {
  let ctx: ExtensionContext | undefined;
  let latest: TaskStateEvent | undefined;

  const render = () => {
    if (!ctx || !latest) return;
    const active = latest.context.activeTask;
    ctx.ui.setWidget(
      latest.widgetId,
      active ? [`Custom task: ${active.id} ${active.title}`] : undefined,
      { placement: "aboveEditor" },
    );
  };
  const attach = (nextCtx: ExtensionContext) => {
    ctx = nextCtx;
    render();
  };

  pi.on("session_start", (_event, nextCtx) => attach(nextCtx));
  pi.on("session_tree", (_event, nextCtx) => attach(nextCtx));
  pi.on("session_shutdown", () => {
    ctx = undefined;
    latest = undefined;
  });
  pi.events.on(TASK_STATE_EVENT, (value: unknown) => {
    if (
      !value ||
      typeof value !== "object" ||
      (value as { version?: unknown }).version !== 2
    ) return;
    latest = value as TaskStateEvent;
    render();
  });
}
```

Event contract:

- name: `pi-tasks:state` (`TASK_STATE_EVENT`);
- payload version: `2`;
- reasons: `session_start`, `session_tree`, or `task_mutation`;
- `widgetId`: stable default widget key, currently `pi-tasks`;
- `context`: state-versioned compact contract containing only the active task,
  current atomic step, unresolved blockers, and evidence gaps.

The default widget is installed before publication, so a synchronous subscriber
may replace it through the supported widget key. With no subscriber, existing
pi-tasks UI behavior is unchanged. Full task history is not published; an agent
can explicitly request it with `task_list({ include_history: true })` after a
contract-recovery failure. Full-history responses above 64,000 characters are
rejected with a short error rather than sent partially; use `task_resume` or
`task_focus` for current work, or `task_list` without history for a summary.
`limit` applies only to the summary list, not full history. The
`pi-tasks:telemetry` event reports compact publication and successful explicit
full-state recovery delivery, including payload size.

## Technical Details

### Capabilities

- Typed task, acceptance criterion, evidence, decision, blocker, and event model
- Pure reducer with transition validation and evidence-before-completion enforcement
- Ordered plan steps; agents must complete or skip the current step before advancing
- Step-level contracts with expected output, linked criteria, required evidence, and optional allowed actions
- Native-model plan quality assessment distinguishes one semantic operation from independently executable or verifiable work across supported source languages
- Persisted version 2 semantic provenance keeps session replay deterministic and model-free while retaining version 1 history compatibility
- Recursive decomposition gate for model-assessed non-atomic steps, with explicit blocker recovery at depth 4
- Step-scoped evidence through `task_evidence.step_ids`
- Current-step evidence lock unless explicit `override_reason` is supplied
- Evidence quality gate: traceable, reproducible, with artifact references
- Evidence budget gate with schema-visible limits and bounded retry templates
- Tool rejections include structured recovery details and targeted correction before `task_resume` guidance
- `task_next` one-step weak-model contract with mode, current-step lock, recommended tool, blocked tools, minimum params
- Scope drift recording for `scope_change` and `off_plan` activity
- Derived progress from completed steps, satisfied criteria, and evidence
- Duplicate evidence detection
- Branch-aware persistence via Pi custom entries (`pi-tasks:event`)
- Session replay from `ctx.sessionManager.getBranch()` on `session_start` and `session_tree`
- Compaction snapshot hook via `session_before_compact`
- Compact status bar and above-editor widget
- Oh My Pi-compatible extension manifest, with critical entrypoint guidance preserved in descriptions for hosts that ignore custom `promptSnippet`/`promptGuidelines` fields
- Inference-free startup semantic capability preflight, deduplicated unavailable warning, and `/tasks doctor` diagnostics

### Verification

Local verification suite:

- `PI_SDK_ROOT=/path/to/@earendil-works/pi-coding-agent npm run release:check` (typecheck + lint + unit/native tests + build parity + tracked-checkout import smoke + pack + audit)
- Fork dogfood passed on 2026-06-18, 2026-06-19, 2026-06-20, and 2026-06-23; upstream reports Pi 1.4.0 and Oh My Pi 18.14.1 dogfood on 2026-10-31. These historical results do not certify this integration.

Dogfood coverage includes: native Pi chat and OMP ephemeral semantic assessment, inference-free healthy startup, static and live `/tasks doctor`, English and Traditional Chinese task creation, task updates, same-session resume, Pi fork replay, `/tasks`, clean `/quit`, and installed-tarball smoke.

## Documentation

- [Product Plan](docs/PRODUCT_PLAN.md) — positioning, scope, research, and `/goal` boundary
- [Implementation Specification](docs/IMPLEMENTATION_SPEC.md) — data contracts, reducer rules, tool contracts, TUI spec
- [Dogfood Checklist](docs/DOGFOOD.md) — real Pi dogfood scenarios and status
- [Weak-Model Prompts](docs/dogfood-prompts/) — English and Traditional Chinese validation prompts
- [Release Process](docs/RELEASE_PROCESS.md) — gates required before publishing

## License

MIT
