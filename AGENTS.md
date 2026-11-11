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

## Semantic Assessment Contract

- Related read-only checks may form one verification bundle for one named claim about one fixed candidate or retained run. Multiple commands or assertions alone are not independent outcomes; unrelated claims remain separate. Apply this guidance equally to classifier, chat and OMP paths without lexical exemptions.
- Keep candidate capture, reviewer dispatch, completed-result assessment, ledger persistence, commit, push and PR creation separate as applicable. A single mutation may include immediate preconditions and receipt verification. Templates never grant authorization, prove reviewer completion or accept ambiguous scope. Rejections provide bounded repair guidance without changing deterministic replay or auto-creating successors. Maintain schema-tested examples in `docs/review-publication-contracts.md`; distinguish controlled unit judgments from native-model validation.

- Semantic inference runs at `task_plan`, `task_decompose`, `task_replan`, `task_rework`, current-step classification through `task_update`, and passing evidence through `task_evidence`, `task_verify_step`, or `task_evidence_batch`. Ordinary updates remain model-free. Batch assessment is all-or-nothing; reject stale state/session or cancellation before persistence. Reducer replay, session restore, branch navigation, rendering, and completion checks must remain deterministic and model-free.
- Use host-native model APIs only: prefer Pi `modelRegistry.classify()`, fall back to Pi `modelRegistry.streamSimple()`, and use Oh My Pi `runEphemeralTurn()` when Pi model APIs are unavailable. Do not add a provider SDK or network client.
- Persist successful semantic results in version 2 task events with assessment version, strategy, provider, model, prompt version, input hash, timestamp, typed judgments, confidence, and bounded issue codes. Continue replaying version 1 history as legacy state without retroactive inference.
- Treat every task/evidence field as untrusted quoted data. Prompts must judge meaning in the source language, reject keyword/length/punctuation heuristics, distinguish conjunctions from independent operations, and request typed structured output.
- Validate assessment shape, index coverage, confidence, decision consistency, provenance, and input hashes before persistence. Malformed, unavailable, failed, low-confidence, or aborted assessment must not mutate task state.
- Propagate the caller's cancellation signal and model usage. Never silently fall back to lexical regex judgment.
- Separate bounded step proof from task acceptance. New `task_verify_step` and batch `verify_step` calls default omitted/empty `criterion_ids` to step-only proof; explicit IDs request proof of those full criteria as well. New criterion-only evidence must not infer or attach an implementation step. Preserve exact assessed targets in contract version 2; reconstruct historical version 1 implicit targeting and hashes without inference. Pending criteria and unproved steps still reject task completion, and existing IDs cannot broaden proof.
- Resolve evidence assessment context from persisted objective, targeted step outputs, selected criterion meanings and role, never from evidence-authored contract prose. Hash the exact bounded contract with the evidence; new assessments use `contractVersion: 2`, while historical version 1 contracts and evidence-only hashes remain replayable without inference. Reject oversized selected contracts rather than clipping meaningful conditions. Retain reducer-derived assessed targets on new evidence; existing-ID step/criterion completion must match those meanings, and reassessment for new targets preserves a separate proof record.
- Negative observations may establish a completed investigation or diagnostic claim, not implementation success. New diagnostic-role recording cannot satisfy criteria or complete a step; use a separate acceptance reporting record for a completed investigation, never convert its diagnostic evidence. Legacy replay semantics remain unchanged. Reproducibility can mean inspection of retained artifacts; never require replay of consumed paid operations. Unsupported chat/OMP responses may retain bounded claim/missing-observation diagnosis; classifier-only recovery names the claim without inventing a model explanation.
- On `session_start` and `session_tree`, inspect semantic capability without inference after the default task UI and `pi-tasks:state` publication. Healthy sessions remain silent; an unavailable session receives one deduplicated warning plus the `pi-tasks-semantic` status.
- `/tasks doctor` must remain a static, model-free report. Only explicit `/tasks doctor live` may send one synthetic semantic assessment, and neither mode may read or mutate task state.

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
- Track live `subagent:async-started`/`subagent:async-complete` events only for the current session when event subscriptions and session identity are available. Accept the exact nonempty current session UUID or session-file path; do not normalize paths or infer identity from a basename. Suppress advisories until all tracked runs finish; preserve waits across input/branch replay and clear subscriptions on shutdown/session start. Runs started before subscription and other asynchronous providers require explicitly recorded waits.
- Keep blocker semantics unchanged: pending decisions use unresolved blockers; decision records alone are not waits. The advisory cannot guarantee detection of unrecorded waits or progress without task execution calls.
- Consume optional `task-continuation:ownership` v1 publications from `named-task-pickup`. The additive `recovery: { inputId, owned }` contract persists the producer's per-input ownership latch. Suppress directly from that authoritative state; never copy it into our sent budget or infer handler ordering. Install the listener before lifecycle replay; only producer publications update ownership. Legacy v1 envelopes retain best-effort relinquishment but cannot guarantee reset/inter-handler safety. Present malformed recovery metadata must not downgrade to legacy parsing or erase valid ownership. Unsubscribe on shutdown. Ignore unsupported/malformed publications without erasing valid ownership.
- The pickup workflow must establish ownership before plan work and explicitly report boundary/completion dispositions. Do not map external task IDs to Pi IDs, infer producer lifecycle from our state, or claim reverse budget transfer after a standalone advisory. Keep the exact pinned producer as a test-only fixture; test both registration orders offline and retain prior settlement entries.

## Orchestration Handoff Contract

- Keep optional handoff lanes on the active task in existing branch-local snapshots; omission preserves them and an explicit empty array clears them. Validate bounded shape on authoring and replay; never add a competing store.
- Resume exposes exact stored identities as historical observations with no authority and mandatory live revalidation. Never launch/reclaim a worker or authorize publication from a checkpoint or receipt. Do not infer terminal child state from absence or promise unattended process restart.
- Handoff metadata neither satisfies evidence gates nor creates/resolves blockers. Use existing task blocker semantics for waits and decisions. Task/branch changes must not leak another task's handoff into the active resume contract.

## Agent Planning Discipline

- Plan deliverables, not support reads or inspection. Provide structured `plan_steps` with expected output, bounded actions, and concrete scope for native-model atomicity assessment.
- Reconcile malformed or duplicate steps before implementation. `task_rework` adds review remediation without replacing prior steps; optional `before_step_id` inserts repairs before a named open gate, otherwise it appends. Use `task_replan` when available for explicit replacement, then follow the corrected resume contract.
- If plan repair is unavailable, report the tracking blocker rather than ignoring the execution contract. Cancellation means the objective was withdrawn, not that completed work is inconvenient to reconcile; retain evidence and repair the tracking instead.
- Correct missing arguments on the rejected tool call before retrying. A missing scope `activity` or cancellation `reason` is not solved by unrelated decomposition.

## Review Rework Contract

- Review findings within the original objective may use `task_rework` without user permission solely to extend the plan; genuine scope or architecture decisions still require explicit `task_decision` records.
- Accept either detailed `reason` + `plan_steps` or one compact `remediation` with finding, deliverable, boundedScope and verification; reject mixed forms before persistence. Normalize compact input into the same `task.reworked` event, never a parallel persisted format. Derive bounded actions and evidence-required metadata, not evidence. Optional `atomic` is a caller attestation only. Assess every normalized step through the native model; derive execution atomicity from the validated assessment, never from the caller flags.
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
- New atomic plans reject every quality issue and aggregate invalid step errors before persistence. Assess cohesive bounded implementation-plus-verification cycles as one deliverable, not a lexical exemption. Preserve selective `criterionRefs` and legacy replay invariants; empty `criterionIds` links all available criteria.

## Routine Context and Atomic Classification

- Bound routine gap/blocker/warning lists with omitted counts and explicit full-history recovery. Compute execution and completion decisions against full state, never summarized lists; retain exact current-step execution IDs.
- Classify an already-simple current step through `task_update.step_granularity_check` without replacing its identity or creating artificial children. Require an explicit reason, all atomicity flags, and a native assessment confirming atomicity; preserve evidence, criteria, blockers, and completion gates.
- Plan deliverables rather than support reads, staging, or receipt bookkeeping. Keep mechanics within the deliverable's allowed execution. Decompose genuinely compound work; classification is not verification or authority to bypass an evidence gate.

## Semantic Deliverable Context and Recovery

- Assess the complete target, owned scope, observable output and bounded verification procedure together. Batch publication/readback, multi-seam investigation reports and focused implementation/regression cycles may be one outcome; neither exact-command phrasing nor a script wrapper determines atomicity.
- Preserve supplied clarification in atomic reclassification, parent scope in decomposition and findings reason in rework. New native assessments retain descriptive unit/scope/verification/reason in materialized state while all atomicity flags remain model-derived; an internal context-version marker preserves historical materialization. Hash the actual context used; historical prompt-version hashes remain replayable without new inference or changed acceptance links.
- Native chat/OMP non-atomic assessments require concrete independent outcomes or missing essential context and the smallest correction; atomic success needs no rejection explanation. Persist and validate typed diagnosis against displayed issues and require complete zero-based index coverage before mapping any native batch; never invent model explanations. Classifier rejections may request one batched native-chat explanation, but explanation failure cannot replace classifier judgments or create a new execution gate.
- Show concrete corrections in rejection, focus and resume guidance. Missing-context reclassification recovery clarifies the same step; genuinely independent outcomes still decompose. Invalid input must not persist events, publish state or erase history.

## Passive Telemetry Contract

- Keep the companion opt-in and separate from task authority and compaction policy.
- Serialize only the versioned allowlist; hash identifiers and never collect prompt, response, tool, error or authorization content.
- Preserve null/zero and context/operation-usage distinctions. Keep incomplete and invalid observations visible; telemetry failure must not block ordinary work.
- Reject duplicate event delivery before changing correlation. Native message_end precedes persistence; a tree leaf is not assistant identity. Invalidate config fingerprints on model changes.
- Phase/recovery markers are explicit producer observations, not inferred semantics or fresh authority. Document proof limits in `docs/compaction-telemetry.md`.

## Compaction Pilot Contract

- Require explicit persisted baseline/pilot assignment per root task/session; replay and inherited forks preserve it. Attribute successful task mutations before idle so same-turn review, blocking or completion cannot drop a cohort. Bind the passive collector with metadata-only observations; never retroactively relabel unknown history.
- Keep intervention independently disableable. Mutation-time attribution must not compact, arm continuation, or bypass idle, retention, engagement or authority checks.
- Use native summarization only at safe idle boundaries; never abort active tools to satisfy an early token target. Native threshold/overflow recovery remains available. Require effective 20k retention only for pilot-owned attempts.
- Persist checkpoint identities in private session entries alongside existing task snapshots, never in a second authority store. Unknown checkpoint identity skips pilot intervention; unbound evidence or external observations remain unknown.
- Recovery compares operation-scoped observations, never grants permission, reclaims ownership or relaunches children. A source/head match is not fresh execution authority; preserve task/PR/run/authorization gates and invalidate only affected evidence.
- Only a successful pilot-owned compaction with current-input execution engagement may request one recovery follow-up. Preserve user redirection, abnormal outcomes, waits and native/installed continuation ownership. Read-only queries or checkpoint calls alone do not arm continuation.
- Emit allowlisted trigger/deferral and recovery telemetry without content. Test real native-hook dispatch plus controlled failure/continuation replay; distinguish that evidence from runtime activation or semantic recovery guarantees.

## Compaction Report Contract

- Keep reporting metadata-only, opt-in and independent of policy/authority. Never infer task completion from session shutdown or useful action from bookkeeping.
- Preserve event deduplication, stable observed cohorts/config strata, child-root accounting and explicit incomplete/unknown denominators. Proxies are not proven waste; unknown costs are not zero.
- Keep private period history/latest and pending/acknowledged notification state. Deduplicate concrete mismatch notices across periods; describe the notification crash window truthfully.
- Use the existing local scheduler with Saturday 09:00 America/Los_Angeles and catch-up-one behavior. Fixture validation never claims installed runtime delivery or automatic adoption.

## Runtime Recovery Contracts

- Bound blocker reports to observed submissions: retain relevant payloads and returned errors or exact transcript references, distinguish exact recovery submissions from adapted scaffolds, and name omitted/changed fields. Unsubmitted variants remain untested; failed attempts do not prove no valid plan exists.
- If suggested fields are unavailable in the installed public schema, report that mismatch without submitting unsupported fields or repeating known-invalid calls. Schema-valid suggestions do not promise semantic success or authorize invented evidence or bypassed execution gates. Keep this guidance in `task_plan` prompt metadata/description and rejection output; host-level schema failures may occur before tool execution.

- Recovery argument scaffolds must match the named registered public tool schema, including nested fields and required arguments. Never expose reducer-owned planning assessment fields. Rejection retries target the rejected operation rather than borrowing an unrelated active task's next action.
- Status-transition recovery targets the rejected task, not the active-task fallback. Blocked-to-review recovery requires actual blocker resolution and an explicit reason before blocked-to-active; completion still uses `task_complete`. Terminal or unsupported transitions explain the remaining action without creating a duplicate objective or mutating state.
- Scaffolds require caller replacement with real scope and observations; schema validity is not semantic acceptance or evidence. Preserve native assessment, evidence, blocker and completion gates. Test generated payloads against registered schemas, not only direct `execute()` calls that bypass host validation.

- A non-atomic step at decomposition depth 4 must direct every guidance surface to an explicit `task_update` blocker; never recommend another decomposition, mark the step done, or create a successor automatically.
- Evidence schemas and reducer validation must share the 500-character summary, 1,000-character observed-output, and 300-character reference/source/command limits. Rejected command, test, and dogfood evidence retries must preserve valid submitted values and use explicit caller-replacement placeholders for missing or over-limit values.
- Supplying `task_update.scope` requires non-empty `activity`; `scope_change` and `off_plan` also require `scope_reason`. Those reducer rejections must recover with a corrected snake_case `task_update`, not the task's unrelated next action.
- Native semantic assessment recovery must preserve deterministic structural gates and return a targeted retry when no model boundary succeeds; rejected assessment calls must not persist events or consume IDs.


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
