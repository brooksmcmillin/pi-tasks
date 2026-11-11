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

New assessments use explicit-target `contractVersion: 2` (task 7980).
Omitted/empty verify-step criterion selections establish only the bounded step;
explicit criteria request proof of those whole criteria too. Criterion-only
records do not infer or attach an implementation step. Plan relevance links do
not imply acceptance proof. Later final-gate evidence can satisfy the same
original criterion without repeating unrelated implementation observations.
Historical `contractVersion: 1` preserves implicit targeting and its exact hash;
pre-contract replay also remains unchanged.
New evidence records carry an internal `contractVersion: 2` authoring marker,
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
| Explicit / omitted / empty verify-step criterion links | require selected criteria / bounded step only / bounded step only | explicit assessed targets, never plan relevance links | registered single/batch, pending final gate and resume tests |
| Criterion-only evidence / multiple explicit targets | no inferred step / all explicit targets required | criterion proof is not implementation proof | later final evidence, exact contract hash and target-reuse rejection |
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
assesses one record with its explicitly selected criteria (none by default); batch assesses each
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

## Bounded step/final-gate evaluation — task 7980

The two-case synthetic corpus in `test/fixtures/bounded-step-evidence.ts` models
focused S4 fixtures followed by a final findings/published-head gate. The same
11-test observations support bounded step proof but not final PR acceptance.
The registered-tool unit regressions use controlled judgments and separately
verify advancement, pending criteria, rejection, eventual acceptance, exact proof
scope and deterministic replay. They do not establish assessor accuracy.

Run only the pair using the command below with `/bounded-step-benchmark` instead
of `/evidence-benchmark` and a fresh output path. Each case runs once, with no
historical paid operation or task-state mutation. On Pi 1.5.2, actual native
`pi_chat`, `openai-codex/gpt-6.1-sol`, prompt `2026-11-11.evidence.v3`, the
[recorded run](bounded-step-benchmark.json) observed at 2026-11-11T20:13:55.940Z
matched **2/2**, with **0 false positives, 0 false negatives, 0 errors** and no
administrative retries. S4 was supported at confidence 0.99; the unsupported
final-PR claim rejected at confidence 1.0 with the pending final observations
identified. Source, contract and corpus SHA-256 identities, full inputs,
judgments and usage are retained in that artifact.

This pair proves only the bounded synthetic scenario on that model, not
universal semantic correctness, a repaired historical session, installed
activation or live Trivy behavior. The older nine-case results below remain
historical evidence for their recorded source/prompt versions, not a claim that
the new source was measured by those old runs.

## Bounded actual-assessor evaluation — task 7886

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
