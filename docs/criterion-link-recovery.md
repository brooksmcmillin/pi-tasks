# Recovering an erroneous step/criterion link

Read on demand:
- Before mutation: [actual runtime checks](#check-the-actual-runtime-first).
- For a wrong mapping: [supported correction](#supported-mapping-correction).
- For the historical incident: [T8 operator recipe](#operator-facing-t8-recipe-not-an-executed-repair).
- For reproduction or acceptance: [rehearsal and proof limits](#reproducible-local-rehearsal-and-proof-limits).

Use supported tools, not session JSONL edits, cancellation of delivered work, or
history resets. A plan link describes an obligation; it is not proof that an
intermediate step satisfies the whole linked acceptance criterion.

## Check the actual runtime first

1. Record the installed Pi version, extension source/package path and exact
   commit/build identity. The package version alone is insufficient: fork builds
   can share a version. Inspect the registered `task_replan`, `task_verify_step`,
   `task_evidence` and `task_resume` schemas/descriptions. Updating source does not
   update a loaded extension; reload the intended build before relying on it.
2. Call `task_resume`, then explicitly request
   `task_list({"include_history":true})` when the compact view lacks the original
   criteria, completed/retired steps or evidence. Retain the original requirement
   text, current step IDs/links, failed and diagnostic evidence, decisions and
   blockers. Follow ordinary task ownership/authorization for any external work.
3. Distinguish a wrong plan mapping from a proof-targeting error. In builds with
   **bounded step proof** (fork change `1bea979`, task 7980), omitting or passing
   empty **snake_case** `criterion_ids` to `task_verify_step` proves only the named
   step. Explicit criterion IDs request proof of the entire named criteria too.
   Validate this behavior on a disposable task against the actual installed build
   if its provenance is uncertain. Schema acceptance alone is not semantic proof.

## Supported mapping correction

`task_replan` can distribute the retired steps' criterion links across explicit
replacement steps. Every retired criterion must still be covered by at least
one replacement. It preserves completed steps, original criteria/statuses,
failed/diagnostic evidence and their historical links, blockers and decisions.
Retired steps remain skipped with `supersededBy`; replacements require fresh
step verification. Replan does not resolve blockers or supersede failures.

For a disposable example, suppose completed `T1-S1` proves configuration criterion
`T1-AC1`, while open `T1-S2` accidentally links an intermediate configuration
regression to final-review criterion `T1-AC2`. These are **example IDs, not T8's
actual criterion meanings**. Replace only the open step:

```json
{
  "task_id": "T1",
  "step_ids": ["T1-S2"],
  "reason": "Separate intermediate configuration proof from final review",
  "plan_steps": [
    {
      "text": "Verify configuration regression",
      "expectedOutput": "Configuration regression passes",
      "allowedActions": ["Run configuration regression"],
      "criterionIds": ["T1-AC1"]
    },
    {
      "text": "Verify final review",
      "expectedOutput": "Final review passes",
      "allowedActions": ["Assess final review"],
      "criterionIds": ["T1-AC2"]
    }
  ]
}
```

Copy actual generated replacement IDs from `task_resume`; do not predict them in
an existing task. Verify the intermediate step using real retained observations
and complete evidence quality, **without** `criterion_ids` unless those
observations also establish the full criterion. Final review/acceptance remains
unverified. A final step's verification alone also does not satisfy its criterion:
explicitly assess that criterion when its full evidence is available.

Important argument distinctions:

- Replacement `plan_steps[].criterionIds` is **camelCase**. Omitted or `[]` links
  **all task criteria**, not zero criteria. This delivery fixes the shared
  replan/rework validator that previously rejected `[]` despite the shared schema's
  all-criteria default. Omission is the compatible all-criteria route on older
  builds; use explicit non-empty IDs for selective mapping.
- Unknown criterion IDs and missing coverage reject without persistence. Replan
  cannot add arbitrary acceptance criteria, delete obligations, unlink by passing
  `[]`, or retire completed steps. If there is no existing criterion appropriate
  for an intermediate step, do not invent one: retain the link and use bounded
  step-only proof on a build that supports it. That is proof separation, not a
  claim that the plan's criterion meaning changed.
- Rejection guidance's `retry_with`/`minimum_params` are schema-valid scaffolds,
  not observed evidence or a guarantee of semantic acceptance. Edit placeholders
  and restore actual coverage before retrying. Preserve submitted payloads and
  errors (or exact transcript references); do not retry a known-invalid payload
  unchanged or infer that unsubmitted alternatives are impossible.
- If a required tool/field is absent from the actual registered schema, report
  that exact capability mismatch and retain the tracking blocker. Do not submit
  unsupported fields, edit persisted state directly, or cancel completed work.

## Operator-facing T8 recipe (not an executed repair)

Historical source: session `01a1c404-c87e-7662-bcd5-bd167e36409c`, discovery entry
`dc87f9a9` and parked event `da42e982`. Rejection entry `21c5d349` explicitly
requested full `T8-AC2` publication/review proof for `T8-S4`'s 11 guarded tests.
That proves those submissions failed, not that all supported replans were
impossible. This task does **not** own the original session, TaskManager 7903,
its Trivy PR, or its human-merge gate.

1. In the original session under its owner's continuation, revalidate the actual
   build and schemas above. Read current T8 history and blocker rather than
   assuming `T8-S4`, `T8-S5`, `T8-S3` or `E53` still has its historical meaning.
   Preserve all original acceptance text and completed history.
2. Inspect the retained diagnostic `E53`, original command transcript, test log,
   tested tree/configuration and current PR head. Historical rejection cited
   `/home/brooks/.local/state/heavy-safe/runs/20261111T000732-1233982-11703.log`.
   Confirm applicability before using its 11-test result. Missing or stale proof
   remains unverified; this document does not attest that log or today's PR.
3. If S4 is still the bounded implementation step and the installed build has
   bounded step proof, prepare a **new acceptance record** with the real retained
   test observations, exact current `step_id` and complete quality/references;
   omit `criterion_ids`. Do not convert diagnostic E53 into acceptance or list
   final AC2 as satisfied. This is an adapted submission with a changed proof
   target, not a retry of the historical full-AC2 payload.
4. If links genuinely need correction and appropriate existing criteria exist,
   use the supported replan sequence above, covering every retired criterion on
   replacements. Otherwise bounded step proof avoids inventing a new criterion.
   Preserve the original blocked state until its specific tracking condition is
   shown resolved; replan itself does not resolve blockers. Use supported blocker
   resolution with an explicit reason/evidence before continuing execution.
5. Resume remaining implementation and final exact-head review separately under
   task 7903's workflow. Failed acceptance evidence still needs explicit passing
   supersession where applicable; review and human-merge gates remain intact.

## Reproducible local rehearsal and proof limits

From this checkout, with dependencies installed:

```sh
npx vitest --run test/unit/plan-repair.test.ts test/unit/rework.test.ts
PI_SDK_ROOT=/absolute/path/to/installed/pi-coding-agent npm run test:native -- -t 'criterion-link recovery'
```

The registered-tool test exercises both source and compiled package entrypoints
using the installed Pi SDK, validates each request and
rejection scaffold against registered schemas, and persists a disposable task
through normal tool calls. It preserves a completed step and failed/diagnostic
records; rejects unknown IDs/coverage loss without mutation; redistributes links;
checks `[]` cannot unlink; verifies an intermediate step without accepting final
AC2; opens the persisted session afresh; and validates resume/focus next-action
arguments. It also rejects premature task completion and exercises `/tasks detail`.

Observed on Pi **1.5.2**, source and compiled builds based on `1bea979`: both
rehearsals pass with next step `T1-S4`, next
allowed action `task_verify_step`, final criterion `T1-AC2` **pending**, evidence
`E1`–`E4` retained and original completed `T1-S1` unchanged. The test's second
replan of intermediate S3 to S5 specifically probes all-criteria `[]` behavior;
it is not a required extra repair operation.

Semantic judgments use the existing controlled offline transport fixture. These
checks establish schema, persistence/replay and deterministic contract behavior,
not live-model judgment, Trivy correctness, current PR readiness, elapsed-time
savings, or repair of the original T8 session. The original session was not
mutated by this rehearsal.
