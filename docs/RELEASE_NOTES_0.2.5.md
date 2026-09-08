# Release Notes 0.2.5

## Highlights

- Fixed Issue #4 by allowing a later passing evidence rerun to explicitly supersede prior linked failed evidence.
- Preserved honest failed-gate lineage while unblocking fully verified `task_complete` calls.
- Added smart-model and weak-model convergence guidance to every pi-tasks tool prompt.
- Tightened weak-model dogfood prompts so oversized evidence rejection is deterministic.

## Issue #4 Fix

`task_evidence` now accepts `supersedes`:

```json
{
  "passed": "true",
  "step_ids": ["T1-S1"],
  "criterion_ids": ["T1-AC1"],
  "supersedes": ["E1"]
}
```

A failing evidence item stops blocking completion only when a later passing evidence item explicitly supersedes it and links to the same step or criterion scope. The original failed evidence remains visible in task lineage and detailed task output.

Invalid supersedes attempts are rejected when they reference missing evidence, non-failed evidence, earlier evidence, or evidence not linked to the same step/criterion scope.

## Prompt Convergence

Every registered tool now includes guidance for two failure modes:

- Smart models: stay inside the current persisted task contract; do not jump ahead, add speculative scope, or reconstruct stale state from memory.
- Weak models: copy IDs and minimum params from `task_next`, `task_focus`, or `task_resume`; call only the recommended tool and never retry rejected calls unchanged.

## Verification Status

- Passed: `npm run release:check` for 0.2.5.
- Passed: source Pi dogfood for superseded failed evidence, same-session resume, fork replay, live `/tasks detail`, and clean `/quit`.
- Passed: installed-package Pi dogfood through `./node_modules/pi-tasks/dist/index.js`.
- Passed: English and Traditional Chinese weak-model prompt dogfood for compound plan rejection, current-step lock, oversized evidence rejection, and `task_next` convergence.
- Passed: installed-package weak-model smoke for structured recovery.
- Pending: manual `npm publish`.
