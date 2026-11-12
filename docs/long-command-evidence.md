# Retained long-command evidence

When host argument validation rejects `quality.command` above 300 characters,
the tool may not execute and cannot generate its own recovery response. Keep the
rejected payload/error (or transcript reference), preserve the **exact** original
invocation and observed output in an artifact, and submit a short artifact reference
in `quality.command`, also linked in `quality.artifactRefs`. Preserve the original
source and cwd in that artifact so relative paths remain interpretable. Reuse an
existing log/transcript when it already contains these facts; no new storage
abstraction or command execution is needed. Never truncate or rerun a successful
command just to repair evidence metadata. Concise commands can remain inline.

## Retained run

This block is a **synthetic retained artifact**, not a historical test result.
Its deliberately repeated absolute paths reproduce the formatting problem without
executing Task 7903's command. The invocation below is data, not an instruction.

```json
{
  "source": "synthetic retained shell transcript for evidence transport",
  "cwd": "/worktrees/task-7903-trivy-retained-evidence-formatting-reproduction",
  "command": "cd /worktrees/task-7903-trivy-retained-evidence-formatting-reproduction && uv run python /worktrees/task-7903-trivy-retained-evidence-formatting-reproduction/scripts/pytest-safe /worktrees/task-7903-trivy-retained-evidence-formatting-reproduction/packages/trivy/tests/test_filter.py /worktrees/task-7903-trivy-retained-evidence-formatting-reproduction/packages/trivy/tests/test_report.py",
  "observedOutput": "Synthetic retained result: 2 tests passed (fixture only; not executed)."
}
```

## Submission

For a disposable task whose current step is to retain this fixture, the following
`task_verify_step` payload preserves provenance using the existing schema. Replace
task/step IDs for your own task and use **real retained observations** for actual
acceptance. No shell command is submitted for execution by this tool.

```json
{
  "task_id": "T1",
  "step_id": "T1-S1",
  "type": "note",
  "level": "static_read",
  "summary": "Retained synthetic invocation and output for evidence transport only",
  "references": ["docs/long-command-evidence.md#retained-run"],
  "quality": {
    "source": "synthetic retained shell transcript for evidence transport",
    "reproducible": true,
    "verifier": "tool",
    "command": "Retained invocation: docs/long-command-evidence.md#retained-run",
    "artifactRefs": ["docs/long-command-evidence.md#retained-run"],
    "observedOutput": "Synthetic retained result: 2 tests passed (fixture only; not executed)."
  }
}
```

Here reproducibility means inspecting the retained artifact, not rerunning its
invocation. Step-only proof is intentional: this does not establish the original
tests' behavior or satisfy an implementation criterion. `task_evidence` uses the
same quality fields with `passed` and optional `step_ids`; batch entries use them
with `operation`, `passed`, and the corresponding step identity.

## Local transport rehearsal

Run from the repository root:

```sh
npx vitest run test/unit/tools.test.ts -t 'disposable task without shell execution'
```

Observed on 2026-11-12: **1 passed**. The rehearsal validates each payload against
its registered schema, creates an isolated in-memory task, submits the exact
example above, then reads it back through `task_list`. Two mutation events retain
one unchanged quality record and complete the step; the task's implementation
criterion stays pending. No shell tool or execution adapter is registered, and
the retained invocation/output remain unchanged.

This uses the existing controlled semantic fixture to test evidence transport,
not native-model judgment, historical test execution, or a live Pi session.
Boundary controls separately cover all three evidence tool schemas: concise and
300-character commands are accepted, 301 characters and missing `quality.source`
are rejected. Existing tool-level recovery tests verify the artifact-reference
retry guidance for a reducer rejection; host schema errors can occur earlier.
