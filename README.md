# pi-tasks

> Pi-native execution contracts for AI agents — no more "trust me, it's done."

## Why pi-tasks?

AI coding agents say "done" without proof. Context compaction loses progress. Multi-step work drifts without anyone noticing. You end up asking "what's the status?" over and over.

**pi-tasks** gives your Pi agent a binding execution contract: structured plans, evidence gates, ordered execution, and compaction-safe resume — all visible in your TUI.

## What makes it different

Every other task tool for AI agents is just a todo list. pi-tasks enforces three hard contracts no competitor offers:

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
| **rpiv-pi** (9.4K/mo, 413★) | Structured workflows | 6 end-to-end flows, 12 subagents, code-review loops | Workflow-oriented; task visibility via separate rpiv-todo |
| **@tintinweb/pi-tasks** (3.2K/mo, 113★) | Task tracking & subagents | Dependency DAG, auto-cascade, file/session/project scoping | Tracks progress; completion is self-reported |
| **Microsoft hve-core** (1,183★) | RPI workflow for Copilot | Research→Plan→Implement→Review, custom agents | Copilot-native; not designed for Pi |
| **pi-tasks** (this project) | Execution contracts | Evidence-gated completion, atomic decomposition, compaction-safe resume | Narrower scope; no subagent orchestration (yet) |

**pi-tasks is for you if** your core problem is agents claiming "done" without proof, plans drifting mid-execution, or context compaction losing progress. If you need workflow orchestration or multi-agent coordination, the tools above may be a better fit — or complement pi-tasks.

## Install

```sh
pi install npm:pi-tasks
```

For Oh My Pi (`omp`):

```sh
omp install pi-tasks
```

Equivalent explicit plugin command:

```sh
omp plugin install pi-tasks
```

Oh My Pi's `--scope project` flag is for marketplace refs such as
`name@marketplace`; it is ignored for npm package specs like `pi-tasks`.

For local development:

```sh
pi install ./
omp plugin install ./
```

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

## Agent Tools

| Tool | Purpose |
| ------ | --------- |
| `task_plan` | Create a task with objectives, criteria, and ordered steps |
| `task_next` | One-step guidance for weak/small-context models |
| `task_focus` | What work is in scope right now |
| `task_resume` | Recover state after compaction or session switch |
| `task_checkpoint` | Save a durable snapshot for compaction resilience |
| `task_granularity_check` | Verify a step is truly atomic |
| `task_decompose` | Break non-atomic steps into child steps |
| `task_rework` | Record review findings and append remediation steps, including reopening done tasks |
| `task_replan` | Replace explicitly named mistaken open steps without discarding history |
| `task_list` | List tasks with optional filtering |
| `task_update` | Advance steps, record activity, flag scope drift |
| `task_evidence` | Attach acceptance or diagnostic evidence and supersede linked failures |
| `task_verify_step` | Atomically attach passing evidence and complete the current atomic step |
| `task_decision` | Record explicit user decisions |
| `task_complete` | Close a task (only if all gates pass) |

## Repairing a mistaken plan

Use `task_replan` for a planning mistake, not `task_rework` (which only appends
review remediation). For example, replace an inspection-only step or duplicate
open steps with the actual deliverable:

```json
{
  "task_id": "T1",
  "step_ids": ["T1-S1"],
  "reason": "Inspection is support work, not a deliverable",
  "plan_steps": [{
    "text": "Rename the Grafana token setting",
    "expectedOutput": "Settings bind the deployed environment variable",
    "allowedActions": ["edit"],
    "decompositionStatus": "needs_breakdown"
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
atomicity flags true) to classify it in place. Its ID, criteria, evidence links,
and completion requirements remain unchanged. Classification does not perform
or verify the work, and cannot be bundled with status/evidence updates.

Plan bounded deliverables, not separate support reads, staging commands, or
receipt bookkeeping. Keep those mechanics within the deliverable's allowed
execution. If a step genuinely contains multiple outputs or independent work,
use `task_decompose`; do not assert atomicity just to avoid the gate.

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
`task_rework`, `task_replan`, `task_update`, `task_evidence`, or `task_verify_step`), a normal
final response can receive **one advisory follow-up per input** if the same task
is still active with an open step and no unresolved blocker. It reuses the compact
resume recommendation: an unrun review or validation is a next action, not itself
an external blocker. The agent must still respect the user's current request and
all review, permission, and verification requirements.

This is not a completion gate or a guarantee of autonomous completion. It never
requires a PR, marks a task complete, blocks tools, or repeatedly restarts the
agent. Read-only task queries, checkpoint/decision calls alone, unrelated answers,
blocked/review/terminal tasks, exhausted plans, abnormal stops, cancellation, and
queued messages do not trigger it. New input and session replay clear prior task
engagement; a stale active task alone cannot restart work. Execution calls are
bound to their explicit target, or the result of an activating `task_plan`;
creating an inactive task never engages a different active task. Consequently, work that
does not call an execution tool in that input is deliberately outside its scope.

Record a genuine decision wait or external obstacle with `task_update`'s blocker
fields (reason, `blockedBy`, and `neededToUnblock`); `task_decision` records a choice,
not an unresolved wait. The advisory explicitly permits human decisions, user
redirection, explanation-only requests, and waiting for asynchronous results.
Hosts without `sendMessage` or `hasPendingMessages` retain existing behavior.

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
contract-recovery failure. The `pi-tasks:telemetry` event reports compact
publication and explicit full-state recovery delivery, including payload size.

## Technical Details

### Capabilities

- Typed task, acceptance criterion, evidence, decision, blocker, and event model
- Pure reducer with transition validation and evidence-before-completion enforcement
- Ordered plan steps; agents must complete or skip the current step before advancing
- Step-level contracts with expected output, linked criteria, required evidence, and allowed actions
- Plan quality gate rejects vague, unverifiable, or over-broad atomic steps
- Stricter atomic scoring rejects compound wording (`and`, `then`, `並且`, `然後`)
- Recursive decomposition gate for non-atomic steps
- Step-scoped evidence through `task_evidence.step_ids`
- Current-step evidence lock unless explicit `override_reason` is supplied
- Evidence quality gate: traceable, reproducible, with artifact references
- Evidence budget gate: oversized text is rejected to keep context lean
- Tool rejections include structured recovery details + `task_resume` guidance
- `task_next` one-step weak-model contract with mode, current-step lock, recommended tool, blocked tools, minimum params
- Scope drift recording for `scope_change` and `off_plan` activity
- Derived progress from completed steps, satisfied criteria, and evidence
- Duplicate evidence detection
- Branch-aware persistence via Pi custom entries (`pi-tasks:event`)
- Session replay from `ctx.sessionManager.getBranch()` on `session_start` and `session_tree`
- Compaction snapshot hook via `session_before_compact`
- Compact status bar and above-editor widget
- Oh My Pi-compatible extension manifest, with critical entrypoint guidance preserved in descriptions for hosts that ignore custom `promptSnippet`/`promptGuidelines` fields

### Verification

Local verification suite:

- `PI_SDK_ROOT=/path/to/@earendil-works/pi-coding-agent npm run release:check` (typecheck + lint + unit/native tests + build parity + tracked-checkout import smoke + pack + audit)
- Real Pi dogfood passed on 2026-06-18, 2026-06-19, 2026-06-20, and 2026-06-23

Dogfood coverage includes: task lifecycle, evidence enforcement, ordered step rejection, structured plan steps, recursive decomposition, compaction-safe resume, duplicate evidence rejection, blocked task display, forked-session replay, tarball install, and weak-model smoke.

## Documentation

- [Product Plan](docs/PRODUCT_PLAN.md) — positioning, scope, research, and `/goal` boundary
- [Implementation Specification](docs/IMPLEMENTATION_SPEC.md) — data contracts, reducer rules, tool contracts, TUI spec
- [Dogfood Checklist](docs/DOGFOOD.md) — real Pi dogfood scenarios and status
- [Weak-Model Prompts](docs/dogfood-prompts/) — English and Traditional Chinese validation prompts
- [Release Process](docs/RELEASE_PROCESS.md) — gates required before publishing

## License

MIT
