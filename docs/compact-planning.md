# Compact standalone planning

Routine standalone PR work may use an outcome-sized checklist. This is the same
structured plan/event format, not a new mode or a bypass of native assessment.
Detailed plans remain useful for independently useful outcomes or explicit
operator preferences. Nexus-managed work still needs no duplicate Pi contract.

## Example checklist

The two deliverables below replace a mechanical list of capture, dispatch,
assessment, receipt persistence, commit, push and PR steps. Each operation still
runs in order with its own required gates. Do not publish before completed
independent review, required checks and current authorization permit it.

```json
{
  "title": "Repair parser regression and publish its reviewed PR",
  "objective": "Deliver one parser regression repair as a reviewed PR; exclude deployment and unrelated parser changes",
  "acceptance_criteria": [
    "The parser repair passes focused regression verification for the fixed candidate",
    "The same candidate has completed independent review, required CI and a published PR under current ownership"
  ],
  "plan_steps": [
    {
      "text": "Produce the verified parser repair candidate",
      "expectedOutput": "One fixed parser candidate with focused regression results bound to its identity",
      "allowedActions": ["Inspect and repair the parser regression", "Run focused verification and retain candidate-bound results"],
      "criterionRefs": [1]
    },
    {
      "text": "Deliver the reviewed parser repair PR",
      "expectedOutput": "Published PR for the verified candidate with completed independent review, required CI and current ownership checks",
      "allowedActions": ["Capture candidate and dispatch independent review; wait and assess completed findings", "Resolve findings and reverify affected proof; retain review and verification provenance", "Check current ownership and exact head before separately committing, pushing and publishing the PR"],
      "criterionRefs": [2]
    }
  ]
}
```

Native classifier, chat and OMP assessment receive the same policy: count owned
outcomes for a deliverable, not its supporting tool calls. Unrelated features or
repositories still need separate deliverables. Caller flags and templates do
not make a plan atomic, confer permission or prove a reviewer finished.

## Reuse proof, not prose

After recording observed evidence against the actual persisted step/criterion
meanings, finish the step with `task_update` using `step_id`, `step_status: "done"`
and `step_evidence_ids`. Complete with `task_complete.evidence_ids` and, where
needed, `criterion_results[].evidenceIds`. No repeated summary, quality fields,
semantic assessment or receipt-only child is required. For new proof,
`task_verify_step` still records and advances in one call.

IDs are not interchangeable: existing proof must support the same target and
role. Diagnostic, missing, failing or pre-rework proof cannot certify success.
A changed head invalidates affected review/verification; retain the old record
as history and record fresh affected proof, using rework when appropriate.
Do not relabel old observations as current. A recorded receipt never establishes
live ownership: recheck it at the controlled operation, and persist a blocker
when authority is lost. Pi's local reducer checks persisted target meanings,
blockers and evidence baselines, not GitHub heads or external leases; those live
checks remain the owning workflow's responsibility.

## Bounded comparison and proof limits

`test/unit/compact-planning.test.ts` compares the existing eight-step detailed
review/publication template with this two-deliverable checklist using registered
schemas, an isolated store and controlled native-model judgments. Both start at
planning and end at completion, receive the same synthetic gate observations,
and retain passing evidence for every criterion. No Git, reviewer, CI or external
ownership service runs in this fixture.

- Detailed path: one plan + eight verify-step submissions + one completion = **10**.
- Compact path: one plan + two verify-step submissions + one completion = **4**.
- Both: zero rejected submissions. The compact path has **six fewer** bookkeeping
  transitions; its second receipt retains the individual operation observations.
- An additional retained-receipt case records proof once, then advances and
  completes using IDs with **zero additional model calls or prose submissions**.

This models the review-handoff bookkeeping in the task-8038 retrospective (35
local bookkeeping calls, eight rejections, about 209 seconds), but does not replay
that session or estimate provider latency or production savings. Controlled
judgments prove schema, policy transport and deterministic gate plumbing, not
that a live model will classify every checklist correctly. Negative fixtures
keep missing verification, changed-head/reworked proof and a persisted
lost-ownership blocker from completing. Live ownership/head detection is not
claimed by these tests.

Run: `npx vitest run test/unit/compact-planning.test.ts`.

After updating the package, build and reload/start a fresh Pi session. Inspect
the effective `task_plan` guidance; already-loaded guidance is not updated by a
source edit. No state migration or historical plan rewrite is required.
