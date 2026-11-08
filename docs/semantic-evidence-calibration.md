# Contract-bound evidence assessment — task 7886

## Boundary

The assessor judges an evidence claim against persisted task objective, targeted
step text/expected output, selected criterion meanings and evidence role. Caller
evidence cannot redefine that contract. All text remains untrusted quoted data.
The exact selected contract is hashed with evidence and included in classifier,
Pi chat and OMP requests. The classifier cache context also carries the evidence
prompt version. Contracts over 65,536 characters reject without truncation;
narrower links are the correction, not dropping meaningful conditions.

A negative experiment can establish a completed reporting deliverable. It cannot
establish successful implementation. A passing diagnostic record means its
specific diagnostic observation is supported, not that the broken implementation
passed. Diagnostic records remain unable to satisfy criteria, verify steps or
supersede failed acceptance evidence. Existing artifact/reproducibility gates,
confidence thresholds, failure supersession and acceptance-only verification are
unchanged. Reproducibility can mean inspecting retained artifacts; no consumed
paid operation is replayed or required.

New assessments opt into contract-bound replay with `contractVersion: 1`.
New evidence records also carry an internal `contractVersion: 1` authoring marker,
including model-free failed/unknown records, so those records cannot bypass
new-record completion checks merely by lacking a semantic assessment.
Historical assessments without the assessment marker retain evidence-only hash
validation; unmarked legacy records keep their historical consumption behavior.
The reducer retains the resolved `assessedContract` on materialized evidence.
Existing-ID consumers (`task_update` step completion, `task_complete`
criterion completion and post-rework freshness) check its objective and exact
target meanings rather than treating an evidence ID as proof for any target.
Passing duplicate shortcuts and ID allocation compare the complete assessed
input hash (evidence plus resolved contract), including verify-step defaults;
manual attachment alone cannot manufacture assessed scope. Reassessment for another target
creates a separate record, preserving the original proof scope. New diagnostic
records remain contextual, not step-completion proof; a completed reporting
outcome can be recorded separately as acceptance without converting diagnostics.
Legacy records preserve their previous replay/consumption behavior. Replay is
deterministic and model-free. Chat/OMP may provide bounded typed
`diagnosis.claim` and `diagnosis.missingObservation`; unsupported responses
cannot use null diagnosis. Supported null diagnosis means absence. Classifier-only
rejection names the submitted claim and supplies generic observation guidance,
not an invented model rationale.

## Decision table and lifecycle map

| Input/state | Outcome and witness | Reason / explanation | Adapter cardinality / verification |
| --- | --- | --- | --- |
| Specific negative trial, reporting step/criterion | supported reporting | observed 0 useful outputs and pre-dispatch authentication refusal establish the report | one contract/evidence pair; paired corpus and route tests |
| Same trial, implementation-success criterion | unsupported | no successful execution; `contradictory_result` | same observations, different persisted contract; corpus |
| Diagnostic fail-first record, broken implementation | supported diagnosis only | concrete failure is observed; criterion remains pending/failed | registered evidence/batch role gates and corpus |
| New failed/unknown evidence without semantic assessment | contextual record, not step-completion proof | internal record marker activates existing passing-acceptance checks without inference | single/batch, diagnostic/acceptance, false/unknown controls; legacy replay retained |
| Reporting success, unrelated failed implementation | reporting criterion only | selective links never erase failure or imply supersession | registered route regression |
| Reuse reporting/diagnostic evidence ID for another step or criterion | reject unassessed success | stored objective/target meanings must match; diagnostic proof remains contextual | registered update/complete rejection and original-target success controls |
| Future expectation / bare reference / unsupported synthesis | unsupported | missing actual findings and connection to claim | paired corpus; native missing-observation diagnosis |
| Synthesis with inspected findings | supported | specific common pre-dispatch cause and trial result | supported/unsupported corpus pair |
| Evidence says to ignore persisted success criterion | unsupported | untrusted evidence cannot redefine target | adversarial corpus control |
| Explicit / omitted / empty criterion links | explicit selection / verify-step defaults / no criterion claim | persisted links, never caller prose | registered routes, default verify-step and implicit unique-step matching tests |
| Multiple matching steps / multiple selected targets | no implicit step / all explicit targets included | mirrors reducer's unique-match rule | shared resolver, exact contract hash; no ranking/tie selection |
| Missing target / oversized selected contract | reject | unknown ID / exact size bound | resolver tests; no clipping |
| Low confidence / malformed response / unavailable model / abort | uncertain or assessment error; no persistence | existing threshold and native error paths | existing semantic and integration regressions |
| Supported null / unsupported null / malformed diagnosis | absence / reject / reject | only supported absence has meaning | Pi chat and OMP parser controls |
| Batch includes invalid evidence | reject entire batch | named failing entry; no events/publication | registered batch regression |
| Same content, different assessed targets | reassess and allocate a distinct ID | complete evidence/contract hash differs; original record unchanged | single, verify, batch record and batch verify reassociation/retry tests |
| Active-step attachment followed by same-evidence submission | reassess new target | attachment alone is not assessed proof | registered shortcut regression |
| Reworked criterion, retained old proof plus fresh unrelated proof | reject stale success | post-baseline proof must support that criterion; matching fresh proof succeeds | registered rework/completion controls |
| Changed objective, output, criterion or links | stale hash rejected | recomputed from actual persisted contract | all three registered routes plus reducer checks |
| Legacy assessment without contract marker | original replay | historical evidence-only hash | legacy compatibility test |

Tools produce context via `evidenceContract` -> native assessor -> reducer ->
version 2 persisted events. `task_evidence` assesses one record; verify-step
assesses one record with its selected/default criteria; batch assesses each
passing entry (1–16 total entries) before atomic persistence. Failed records keep
their existing model-free path. Reducer replay validates the same resolved
meanings without inference. Existing-ID step/criterion completion consumers
validate retained proof scope; duplicate detection preserves separately assessed
targets instead of broadening one evidence record. Rework freshness and all
single/batch/verify duplicate shortcuts consume the same scoped proof identity. Startup, wait, dispatch, credentials, source filtering
and authorization policies are unchanged. No generated API client is involved;
`npm run build` refreshes the distributed entry point. CI has no changed-path
filters: `release-check` runs all unit tests and the native suite, including the
new unit files. This code delivery does not activate an installed extension.

## Bounded actual-assessor evaluation

`test/fixtures/semantic-evidence.ts` is a sanitized, synthetic nine-case corpus.
Its artifact names and observations are fixtures, not claims that the historical
trial was rerun or its private logs inspected. The first two cases have identical
failed-experiment observations and different reporting/implementation contracts.
Unit tests use controlled classifier judgments to verify transport and state;
they do **not** establish semantic accuracy. The separate development extension
uses actual host-native assessment, without task mutation tools:

```sh
pi --no-extensions --no-mcp --no-skills --no-prompt-templates --no-themes \
  --no-context-files --no-tools --no-session \
  --provider openai-codex --model gpt-6.1-sol \
  -e ./scripts/evidence-benchmark.ts \
  -p '/evidence-benchmark /absolute/new-results.json'
```

Each case runs once with a 60-second deadline. Output records prompt version,
source/corpus SHA-256, actual model/provenance, usage, elapsed time, errors and
false-positive/negative counts. Native provider configuration resolves auth;
no credential is exported. No historical mutation or paid trial is executed.

On Pi 1.5.0, native `pi_chat`, `openai-codex/gpt-6.1-sol`:

| Case | Reviewed expectation | Initial evidence.v1 | Corrected evidence.v2 |
| --- | --- | --- | --- |
| negative-trial-report | supported | supported | supported |
| negative-trial-implementation | unsupported | unsupported | unsupported |
| contradictory-success | unsupported | unsupported | unsupported |
| future-expectation | unsupported | unsupported | unsupported |
| reference-only | unsupported | unsupported | unsupported |
| supported-synthesis | supported | invalid null diagnosis | supported |
| unsupported-synthesis | unsupported | unsupported | unsupported |
| diagnostic-not-implementation | supported diagnosis | unsupported | supported |
| evidence-cannot-redefine-contract | unsupported | unsupported | unsupported |

The [initial run](evidence-benchmark-initial.json) matched 7/9, with zero false
positives, one false negative and one native-output error. That exposed a policy
sentence applying implementation-success requirements to diagnostics and the
supported null-diagnosis representation. Both were corrected with regressions.
The [corrected run](evidence-benchmark-results.json), observed
2026-11-08T03:12:09.589Z, matched 9/9: **0/6 false positives, 0/3 false negatives,
0 errors**. Both runs are retained; total workload was 18 case assessments across
two source revisions, not retries hidden behind the final score. Neither is a
baseline measurement of the previously shipped evidence-only prompt.

This is one small corpus on one native model, not a guarantee of arbitrary
semantic correctness or historical rejection frequency. Classifier and OMP
transport/policy are tested deterministically; their real-model accuracy was not
measured. Native judgment and deterministic quality/role gates remain required.
