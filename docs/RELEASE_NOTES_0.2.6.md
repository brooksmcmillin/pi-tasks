# Release Notes 0.2.6

## Highlights

- Fixed PR #5 so concrete passing evidence summaries are not rejected merely because they contain vague words such as `done` or `完成了`.
- Kept vague passing summaries blocked with matched-fragment feedback that tells agents to describe the observed result, without exposing the internal length heuristic as a target.
- Added English and Traditional Chinese regression coverage for concrete short summaries and vague summaries.

## Vague Evidence Gate Fix

`task_evidence` still rejects passing evidence summaries that are genuinely vague:

```text
Evidence summary is too vague for passing evidence (matched "done"); describe the observed result
```

Concrete observed summaries now pass even when they include status words:

```text
CLI returned MATCH Done/Done
畫面顯示完成了並回傳 code 0
```

The gate now combines whole-summary vague phrase checks with observed-result signals for short summaries. The summary-length cutoff remains an internal heuristic; agent-facing guidance asks for observed command/tool output or state instead of asking for longer text.

## Verification Status

- Passed: strict PR review; initial PR implementation had one blocker for short concrete summaries, fixed by maintainer commit `013af77` before merge.
- Passed: `npm run release:check` for 0.2.6.
- Passed: source Pi dogfood for Traditional Chinese vague-summary rejection, concrete Chinese evidence acceptance, task update, task completion, and detailed task listing.
- Passed: same-session resume, fork replay, live `/tasks detail`, and clean `/quit`.
- Passed: English weak-model source prompt for vague `done` rejection and concrete `CLI returned MATCH Done/Done` acceptance.
- Passed: installed-package tarball import and Pi dogfood through `./node_modules/pi-tasks/dist/index.js`.
- Pending: manual `npm publish`.
