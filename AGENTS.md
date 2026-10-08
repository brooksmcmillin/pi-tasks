# Development Rules

## Product Goal

Build a Pi-native task and progress contract that lets both the agent and the user understand:

- what is being implemented,
- why it is being implemented,
- current progress and blockers,
- acceptance criteria,
- verification evidence,
- user decisions,
- and whether the task is truly complete.

This project must align with the commercial-quality bar established by `pi-knowledge`: verified behavior, clear docs, release gates, and no misleading claims.

## Architecture Baseline

- Target runtime: Pi coding agent extension system.
- Primary state should be Pi session-aware and branch-aware.
- The extension should use Pi-native APIs before external protocols:
  - `registerTool`
  - `registerCommand`
  - `appendEntry`
  - `setLabel`
  - `ctx.ui.setWidget`
  - `ctx.ui.setStatus`
  - lifecycle events such as `session_start`, `session_tree`, `turn_end`, and `session_shutdown`
- MCP or Markdown export can be added later, but should not replace the Pi-native core.
- Preserve Oh My Pi compatibility when using Pi-native APIs:
  - keep package manifests readable through `pi.extensions`;
  - avoid relying on `ctx.mode`; use API capability checks such as `ctx.hasUI` only when needed;
  - mirror critical `promptGuidelines` into tool `description` text because Oh My Pi consumes `description`/`parameters` for model-facing tool guidance.

## Task State Event Contract

- Publish `pi-tasks:state` only after the default status/widget refresh completes.
- Publish on `session_start`, `session_tree`, and every successful persisted task mutation; rejected mutations must not publish.
- Keep payload versioned. Version 2 contains `reason`, stable `widgetId`, and a compact context limited to the active task, current atomic step, unresolved blockers, evidence gaps, and a state version.
- Do not publish full task state or history. Serve it only after an explicit recovery request through `task_list({ include_history: true })`.
- Emit telemetry for compact publication and explicit recovery delivery; observer failures must not prevent either task persistence or the independent telemetry event.
- Isolate observer failures from task persistence and tool success.
- Preserve default UI when no consumer subscribes. A synchronous consumer may intentionally replace the default widget through the published `widgetId`.

## Implementation Rules

- TypeScript strict mode.
- ESM only.
- No `any` unless the boundary truly requires it and the rationale is documented.
- Keep startup light. Avoid loading optional UI-heavy modules at extension import time unless Pi requires them.
- Prefer deterministic local state transitions over prompt-only behavior.
- `task_plan` and `task_resume` must have clear `promptSnippet` and `promptGuidelines`, with critical guidance reflected in `description` for hosts that ignore custom prompt fields. Lazily activated task controls use compact descriptions without active-only prompt metadata.
- Long-running operations must support cancellation where applicable.
- TUI custom renderers and widgets must be width-safe and tested in real Pi TUI sessions.

## Product Rules

- This is not just a todo list.
- Every active task must be able to answer:
  - objective,
  - current status,
  - next action,
  - acceptance criteria,
  - verification evidence,
  - unresolved user decisions,
  - and completion confidence.
- The system must not mark work complete without verification evidence.
- Record expected or remediated fail-first results with evidence role `diagnostic`; diagnostic evidence may support diagnostic steps and remain linked for context, but must not change criterion status or satisfy task completion.
- Evidence without an explicit role is acceptance evidence for backward compatibility.
- A linked acceptance failure may stop blocking completion only through an explicit passing acceptance replacement that names the superseded evidence and gives a non-empty reason; retain both records and never infer supersession from a later pass.
- The agent may propose task changes, but user-facing decisions must be recorded explicitly.

## Advisory Yield Contract

- At `agent_before_settle`, offer at most one atomic continuation per input after a successful task execution call, using fresh state and the existing resume contract for the same active task with an open step and no unresolved blocker. Return a custom message entry with `continue: true`; never queue a `sendMessage` follow-up from `turn_end`.
- Missing prerequisites are next actions, not automatic blockers; never bypass them. Guidance must preserve user stops/redirection, explanation-only requests, human decisions, authority boundaries, and asynchronous waits.
- Do not infer authorization from a stale active task, parse final-response prose, require a PR, force completion, or implement a retry loop. Read-only task queries and checkpoint/decision calls alone must not arm continuation.
- Suppress blocked/review/terminal tasks, exhausted plans, abnormal outcomes, cancellation, pending messages, and already-requested boundary continuations. Reset engagement on input/session replay/shutdown. Hosts without the settlement boundary do not receive advisories.
- Track live `subagent:async-started`/`subagent:async-complete` events only for the current session when event subscriptions and session identity are available. Suppress advisories until all tracked runs finish; preserve waits across input/branch replay and clear subscriptions on shutdown/session start. Runs started before subscription and other asynchronous providers require explicitly recorded waits.
- Keep blocker semantics unchanged: pending decisions use unresolved blockers; decision records alone are not waits. The advisory cannot guarantee detection of unrecorded waits or progress without task execution calls.
- Consume optional `task-continuation:ownership` v1 publications from `named-task-pickup`. Handled intent, exhausted budget or pending async work suppresses our advisory and relinquishes it for the current input. Install the listener before lifecycle replay; do not clear producer ownership from our input/replay handlers, which would make behavior load-order dependent. Unsubscribe on shutdown. Ignore unsupported/malformed publications without erasing valid ownership.
- The pickup workflow must establish ownership before plan work and explicitly report boundary/completion dispositions. Do not map external task IDs to Pi IDs, infer producer lifecycle from our state, or claim reverse budget transfer after a standalone advisory. Keep the exact pinned producer as a test-only fixture; test both registration orders offline and retain prior settlement entries.

## Agent Planning Discipline

- Plan deliverables, not support reads or inspection. Provide structured `plan_steps` with expected output, bounded actions, and truthful atomicity declarations.
- Reconcile malformed or duplicate steps before implementation. `task_rework` adds review remediation without replacing prior steps; optional `before_step_id` inserts repairs before a named open gate, otherwise it appends. Use `task_replan` when available for explicit replacement, then follow the corrected resume contract.
- If plan repair is unavailable, report the tracking blocker rather than ignoring the execution contract. Cancellation means the objective was withdrawn, not that completed work is inconvenient to reconcile; retain evidence and repair the tracking instead.
- Correct missing arguments on the rejected tool call before retrying. A missing scope `activity` or cancellation `reason` is not solved by unrelated decomposition.

## Review Rework Contract

- Review findings within the original objective may use `task_rework` without user permission solely to extend the plan; genuine scope or architecture decisions still require explicit `task_decision` records.
- Persist `task.reworked` with a non-empty findings reason and validated, evidence-required remediation steps. Use collision-free root IDs independent of insertion position; never discard prior steps, evidence, decisions, blockers, warnings, or events.
- Rework may reopen done tasks, but not cancelled tasks, and must not displace another active task. Without `before_step_id`, existing open work remains ahead of appended repairs. With it, insert repairs before that existing open step; reject nonexistent, done, or skipped targets atomically. Preserve the target's ID, evidence, criteria, and verification obligations, and retain earlier open work in order. If repairs become current, return the displaced active gate to pending. Unresolved blockers stay blocked.
- Reset affected criteria to pending, require fresh passing acceptance evidence after their rework evidence baseline, clear completion metadata/confidence, and recalculate progress. Retain old evidence links; neither relinking old proof nor rework itself supersedes failing acceptance evidence.
- `task_next`, `task_resume`, and `task_focus` must expose the explicit rework path for review findings, including exhausted plans with verification gaps. The recommended tool must be in nextAllowedActions and must not be blocked. Completion recommendations are conditional on verified implementation, not an instruction to ignore new findings.

## Planning Repair Contract

- `task_replan` records `task.replanned` to replace explicitly named open steps with non-empty, validated replacements covering all retired criterion links. It is not review remediation; `task_rework` adds findings-driven repairs, optionally before an open gate, without retiring existing steps.
- Retain retired steps, IDs, evidence links, decisions, blockers, warnings, and events. Mark retired entries skipped with `supersededBy`; do not count them as completed deliverables or demand execution evidence for the retired planning entry.
- Replacement steps require ordinary verification. Preserve criterion status, evidence baselines, and failed-evidence gates; repair does not complete work or resolve blockers. Reject terminal tasks and displacement of another active task.
- Apply tightened inspection-mechanic authoring validation before persistence across creation, decomposition, rework, and replan. Legacy inspection events must remain replayable so they can be repaired.
- Planning schemas require structured steps with bounded `allowedActions`; argument-error recovery names the corrective tool and exposes missing parameters without pretending an unrelated decomposition fixes the call.

## Routine Context and Atomic Classification

- Bound routine gap/blocker/warning lists with omitted counts and explicit full-history recovery. Compute execution and completion decisions against full state, never summarized lists; retain exact current-step execution IDs.
- Classify an already-simple current step through `task_update.step_granularity_check` without replacing its identity or creating artificial children. Require an explicit reason, all atomicity flags, and ordinary quality validation; preserve evidence, criteria, blockers, and completion gates.
- Plan deliverables rather than support reads, staging, or receipt bookkeeping. Keep mechanics within the deliverable's allowed execution. Decompose genuinely compound work; classification is not verification or authority to bypass an evidence gate.

## Verification Rules

Before claiming readiness:

- Run unit tests.
- Run `node --experimental-strip-types -e "import('./index.ts')"`.
- Run `npm pack --dry-run`.
- Run Pi dogfood with at least:
  - task creation,
  - task update,
  - `/tasks` command,
  - session resume,
  - branch/fork behavior if implemented,
  - and `/quit` clean exit.

Skipped gates must be reported as skipped, not passed.

## Documentation Rules

- Behavior contracts belong in `AGENTS.md`.
- User-facing capabilities belong in `README.md`.
- Product and architecture planning belongs in `docs/`.
- Release process must be documented before the first npm release.
