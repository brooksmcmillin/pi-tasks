# Review-contract comparison

## Historical observation

The owner-admission retrospective reported 115 task-management calls, 7.70 minutes
inside those tools and 15 atomicity/specificity rejections. Those are whole-session
observations, not a savings estimate.

A bounded publication segment in session
`01a1b25f-ec34-742a-8919-1feb47970112`, JSONL lines 142–184, contains:

| Operation | Calls | Source lines |
| --- | ---: | --- |
| `task_update` | 4 | 142, 147, 158, 170 |
| `task_decompose` | 3 | 144, 149, 172 |
| `task_verify_step` | 4 | 155, 167, 177, 184 |
| Total | 11 | 142–184 inclusive |

Three call results rejected atomicity (lines 143, 148, 171). The segment began with
an existing publication step; it does not include initial planning. It eventually
separated commit, push, PR-description preparation and PR creation.

Method: parse each JSONL message in the inclusive range, count assistant content
blocks with `type == toolCall` and `name` starting `task_`, and separately count
matching tool-result error responses. Do not count quoted calls or result text as
additional invocations. The private transcript is not shipped in this package.

## Template-path replay

`test/unit/review-contracts.test.ts` extracts the last three publication steps from
`docs/review-publication-contracts.md`, validates every call against its registered
public schema, and executes them in an isolated store with controlled native-model
responses and synthetic receipt evidence:

- One `task_plan` call.
- Three `task_verify_step` calls, retaining distinct commit, push and PR receipts.
- Four calls total, no rejections. Description preparation stays with PR creation.

This is **11 observed historical calls versus 4 controlled replay calls**, a
seven-call difference for this limited comparison, not a measured production
speedup. It includes initial planning on the replay side. The replay does not run
Git, launch reviewers, contact GitHub, prove permission, or establish real delivery.
Additional decisions, waits, failures or changed candidates still require calls.

## Native semantic probe

On 2026-11-07, an isolated Pi `ModelRuntime.streamSimple` probe used
`openai-codex/gpt-5.6-luna` and prompt version `2026-11-07.v3`:

- Historical/revised corpus: four expected atomic cases were atomic (PR creation,
  push receipt checks, ledger persistence with identity preconditions, and one
  fixed-candidate read-only verification bundle).
- Four negative cases were non-atomic. Commit-plus-push and unrelated claims needed
  breakdown; ambiguous publication was rejected. Review including hidden repairs
  was rejected for specificity rather than the corpus's `needs_breakdown` label:
  7/8 exact-label agreement, 8/8 intended atomic/non-atomic boundary agreement.
- The first two eight-template probes returned nine judgments and were rejected by
  exact coverage validation. No response was truncated or accepted partially.
- After binding the response schema and prompt to the exact input step count, the
  next probe returned eight judgments, all atomic, for the eight documented steps.
  Its normalized input hash was
  `ea9547e225ab8d4ac1c23addad48d1cd950e0af970d9ec1fb73a9f00a956e5f6`.

These are bounded observations from one model, not guaranteed classifier accuracy,
latency savings, or a reason to disable assessment. Controlled unit tests prove
transport and gate handling, not semantic inference. The eight-case corpus remains
available for future native probes, including its stricter-than-expected rejection.
No full workflow or whole-session before/after timing experiment was performed.
