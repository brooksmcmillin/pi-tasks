# Semantic planning calibration — task 7885

## Boundary and reviewed corpus

The unit is a bounded observable deliverable, not one tool call. Implementation
and focused verification may be one cycle. Task records, graph edges and readback
may be one graph publication; several evidence seams may support one report.
Unrelated products remain separate even behind a single script. Caller flags are
not authority. No task execution, lifecycle policy or evidence gate is relaxed.

`test/fixtures/semantic-deliverables.ts` contains eight sanitized cases with labels
reviewed independently **before tuning**. No historical mutations or private
transcript content are replayed. Cases are expectations, not semantic guarantees.

| Input/state | Candidate count | Decision | Deciding witness / explanation | Adapter cardinality / proof |
| --- | ---: | --- | --- | --- |
| Bounded publication, prose or command wording | one step | atomic | one reviewed graph and graph readback | full step plus objective/criteria; paired corpus |
| Report with three evidence seams | one step | atomic | one sourced report, reads support that report | full bounded report; corpus |
| Focused repair with unit and replay checks | one step | atomic | checks establish the same context-preservation result | full procedure, not framework count; corpus |
| Unrelated products behind one script | one step | needs_breakdown | OAuth refresh and separately deployable billing dashboard | two independent outcomes; corpus |
| Publish graph and implement cross-system repairs | one step | needs_breakdown | graph publication and independent repair products | multiple independent outcomes; corpus |
| Essential target/scope/result absent | one step | rejected | names missing information and smallest clarification | no invented scope; corpus |
| Mixed-language equivalent | one step | atomic | same bounded graph publication | source-language policy; corpus |
| New atomic clarification | one current step | assessed, not caller-approved | supplied scope and verification replace stored derived flags as model input | registered-tool request and replay tests |
| Decomposition | two or more children | each assessed | parent scope and reason retained; no per-item split required | one native request with all children; adapter tests |
| Rework/replan | one or more replacements | each assessed | task criteria plus findings reason retained | one native request with all proposed steps; replay tests |
| Classifier non-atomic, chat available | one batch | classifier decision retained | optional native chat diagnosis names outcomes/missing context and correction | one batched diagnostic request, only after non-atomic counts |
| Classifier non-atomic, chat unavailable/fails | one batch | classifier decision retained | counts remain visible; concrete diagnosis is unavailable, not invented | no extra permission or availability gate |
| Chat/OMP response | one batch | typed judgments | typed diagnosis is included for non-atomic steps | one response, source-order indexes preserved |
| Low confidence / unclear count | any | rejected | uncertainty remains explicit, no forced atomic acceptance | existing threshold unchanged |
| Malformed diagnosis / contradictory atomic diagnosis | any | invalid output | no persistence; native adapter fallback remains available | parser and registered-tool rejection tests |
| Abort / unavailable model | any | assessment error | preserve cancellation or unavailable error | existing no-mutation tests |
| Empty plan / malformed authoring input | zero / invalid | rejected | existing schema/reducer correction | no task events persisted |
| Legacy semantic event | any | original replay decision | historical prompt hashes exclude newly supplied context | compatibility tests; no history rewrite |

Requested atomic flags are advisory for all available/absent/invalid branches;
invalid authoring shape remains a schema/reducer error. Ranking, ties, pagination
and source filtering are not applicable: the model classifies the supplied array
without candidate selection, and every returned index must match the full input.

## Local native comparison

Run the explicit development extension, not production task mutation tools:

```sh
pi --no-extensions --no-mcp --no-skills --no-prompt-templates --no-themes \
  --no-context-files --no-tools --no-session \
  --provider openai-codex --model gpt-6.1-sol \
  -e ./scripts/semantic-benchmark.ts \
  -p '/semantic-benchmark /absolute/new-results.json'
```

Each case has a 60-second deadline and is attempted once; the eight-case run is
bounded. Results include prompt version, assessor source and corpus hashes,
actual per-response model/provenance, usage, agreement and elapsed time. Ordinary
native provider configuration resolves authentication; no credential is exported.
Administrative retries count caller rewording/rerunning, not native provider
fallback. Do not treat missing/error rows as successes.

Baseline on Pi 1.5.0, `openai-codex/gpt-6.1-sol`, native `pi_chat`, prompt
`2026-11-04.v2`: **6/8 exact-label agreement**, zero administrative retries.
All five cohesive cases were already accepted on this host. Both multi-product
cases were rejected rather than classified for actionable breakdown; the missing
boundary case was rejected. Thus this run does **not** reproduce the historical
cohesive false rejection and cannot establish its frequency.

Final candidate, same host/model and corpus, prompt `2026-11-07.v3`: **7/8
exact-label agreement**, zero administrative retries. All five cohesive cases
remained atomic; OAuth plus billing now received actionable breakdown with named
independent outcomes. The cross-system graph-plus-repairs case still received a
rejection, naming absent repair boundaries and recommending separate graph and
repair outcomes. This is a remaining disagreement with its reviewed label, not
perfect classification. Essential-missing-boundary rejection was preserved.

| Case | Expected | Baseline v2 | Candidate v3 |
| --- | --- | --- | --- |
| batch-prose | atomic | atomic | atomic |
| batch-command | atomic | atomic | atomic |
| bounded-report | atomic | atomic | atomic |
| focused-repair | atomic | atomic | atomic |
| independent-products | needs_breakdown | rejected | needs_breakdown |
| publish-and-implement | needs_breakdown | rejected | rejected |
| missing-boundary | rejected | rejected | rejected |
| mixed-language-batch | atomic | atomic | atomic |

[`semantic-benchmark-results.json`](semantic-benchmark-results.json) retains
sanitized raw assessments, usage, observations, exact source/corpus hashes and
model identities. Baseline source SHA-256 is
`3967fe6ece50e96c03cce9c8f69f4032303677e7cafa0569ee6a29c4f0e2922b`;
final candidate is
`aeedfcb7feea029802d04426d6dbc8a7b44432409bbca22d051ba0d4c6835a38`.
One intermediate candidate revision also scored 7/8 before diagnosis replay
validation was integrated. Total native workload was 24 case assessments across
three source revisions, not repeated attempts to improve a reported score.
A subsequent focused fix preserves combined classifier/chat token usage if an
optional diagnostic request aborts (covered by `semantic-diagnosis.test.ts`). It
does not change the prompt, payload or direct `pi_chat` path exercised by this
comparison; the saved source hash identifies the measured revision, not that
later accounting-only source revision.

The live installed planning tools controlling this implementation separately
required failed atomic-classification and decomposition attempts followed by
replanning; those are real administrative friction in this session, not
benchmark retries.
The candidate was not installed into that controller. The comparison demonstrates
a modest actionable-breakdown improvement on this corpus, **not** a demonstrated
reduction of historical cohesive false rejections. A small local corpus cannot
prove semantic correctness for arbitrary prose or other models. Classifier-only
hosts retain count-based guidance when native chat diagnosis is unavailable;
they do not invent concrete model explanations.
