# Routine receipt payload comparison

Task: https://nexus.brooksmcmillin.com/task/7269

## Reproduce

```sh
npm ci --ignore-scripts
npx vitest --run test/unit/receipts.test.ts --reporter=verbose --disableConsoleIntercept
```

The sanitized fixture creates a three-step atomic plan, then alternates a next-action update with step verification for each step (six routine calls). No private transcript or claim data is used.

Baseline is the success prefix plus the current `formatTaskResume` for the exact same resulting state. This comparison models the full-success rendering used at `6f1b2403707eabbba21dd70c16e1280072c39796`; it does not freeze that revision's contract text. Revised output is the actual registered tool's text content. Initial planning and explicit resume are excluded from both routine totals because those still return full contracts. Structured details are unchanged and checked against `buildTaskResume` on every call.

Observed locally on 2026-10-01:

| Routine text | Characters |
| --- | ---: |
| Baseline full success receipts | 4,818 |
| Compact success receipts | 3,593 |
| Reduction | 1,225 (25.4%) |

After `task_evidence_batch` was added to permitted actions, both totals increased by 105 characters: baseline 4,923, compact 3,698, still saving 1,225 characters (24.9%). The regression guard requires at least 20% savings, leaving headroom for shared contract guidance rather than treating the original 25.4% observation as a permanent minimum. Returning full contracts for every call would still fail the guard. Counts are logged before the assertion so failures retain the comparison.

The final explicit resume reaches the same legal next tool, `task_complete`. Regressions additionally cover first-use full guidance, step changes, replay/compaction recovery, rejected mutations, failed checks, and newly added constraints beyond existing display caps. Full-state history persistence and oversize-history rejection remain covered by the existing state-event tests.

## Contract and limits

Routine receipts include identity, status/progress, current step, mode, next permitted actions, prohibited tools, and newly relevant gaps/blockers/warnings/failed checks. Changed step contracts and next-tool parameters are included when needed; unchanged lineage, historical warnings and full recovery templates are not repeated.

Use `task_resume` or `task_focus` for the applicable execution contract and `task_list({ include_history: true })` for retained state. Display caps report omitted counts; they never trim persisted state or decide execution/completion. First success after replay or an automatic compaction checkpoint returns a full contract. Error recovery stays full. Receipt tracking is runtime-only, not a new state store.

This is a synthetic local character-count comparison, not a tokenizer, deployed latency, or model-time benchmark. Model-time attribution is **unknown**.
