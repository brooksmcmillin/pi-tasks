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
- All agent-facing tools must have clear `promptSnippet` and `promptGuidelines`, and their critical guidance must also be reflected in `description` for hosts that ignore custom prompt fields.
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

## Review Rework Contract

- Review findings within the original objective may use `task_rework` without user permission solely to extend the plan; genuine scope or architecture decisions still require explicit `task_decision` records.
- Persist `task.reworked` with a non-empty findings reason and validated, evidence-required remediation steps. Append steps with collision-free root IDs; never discard or rewrite prior steps, evidence, decisions, blockers, warnings, or events.
- Rework may reopen done tasks, but not cancelled tasks, and must not displace another active task. Existing open work remains ordered before appended steps. Unresolved blockers stay blocked.
- Reset affected criteria to pending, require fresh passing acceptance evidence after their rework evidence baseline, clear completion metadata/confidence, and recalculate progress. Retain old evidence links; neither relinking old proof nor rework itself supersedes failing acceptance evidence.
- `task_next`, `task_resume`, and `task_focus` must expose the explicit rework path for review findings, including exhausted plans with verification gaps. The recommended tool must be in nextAllowedActions and must not be blocked. Completion recommendations are conditional on verified implementation, not an instruction to ignore new findings.

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
