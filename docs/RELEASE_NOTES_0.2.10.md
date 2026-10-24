# Release Notes 0.2.10

## Highlight

- Fixed #13: valid plans no longer fail when callers send an empty `criterionIds` array, wording failures identify their exact matched fragment, and one rejection reports every invalid submitted step.

## Plan Creation Recovery

New task and decomposition steps now treat empty `criterionIds` arrays like omitted arrays and auto-link the available task criteria. Non-empty arrays still reject unknown generated criterion IDs, preserving the criterion-link invariant.

Plan validation now evaluates every submitted step before rejecting the event. A multi-step plan receives one indexed error list instead of discovering later invalid steps through repeated full-plan retries. The reducer remains atomic: no task event or partial step state is persisted after any validation failure.

## Plan Quality Diagnostics

Vague and compound wording failures now include the exact matched fragment, such as `"Fix"` or `"and"`. Every quality issue on an atomic step is a hard failure, matching the documented atomic-step contract. Non-atomic steps retain scored validation so deliberately coarse work can still enter the required decomposition flow.

Path-token exclusions remain intact: action-like filename segments such as `fixtures/fix.json`, `update.json`, and `then.json` remain valid when the surrounding plan is concrete.

## Regression Coverage

Reducer regressions cover:

- empty `criterionIds` auto-linking all task criteria during creation and parent criteria during decomposition;
- a single vague wording issue rejecting with its matched token;
- a single compound output issue rejecting with its matched token;
- all invalid step indexes appearing in one rejection; and
- existing path-token and recursive-decomposition behavior remaining valid.

## Dependency Security

Vitest was updated to 5.0.5, bringing patched `@vitest/mocker` and Vite transitive dependencies into the development and release toolchain. The release audit reports zero vulnerabilities.

## Verification Status

- Passed `PI_SDK_ROOT=/tmp/pi-tasks-sdk-1.3.0/node_modules/@earendil-works/pi-coding-agent npm run release:check`: strict typecheck, Biome, 94 unit tests, 7 native Pi SDK tests, build, source/dist imports, pack dry-run, clean tarball install/import, and zero-vulnerability audit.
- Passed real Pi 1.3.0 source lifecycle dogfood: aggregated two-step rejection with matched fragments, empty-criteria task creation, update, decision, blocker/unblock, evidence quality recovery, duplicate evidence, completion, same-session resume, and fork replay.
- Passed live `/tasks detail` rendering and clean `/quit`.
- Passed fixed English and Traditional Chinese weak-model prompts for compound-plan rejection, current-step evidence locking, evidence-budget enforcement, and `task_next` convergence.
- Passed installed `pi-tasks-0.2.10.tgz` smokes for structured invalid-plan recovery and valid empty-criteria task creation.

## Publishing

The GitHub release contains the verified source and package metadata for `0.2.10`. npm publication remains a separate manual maintainer action.
