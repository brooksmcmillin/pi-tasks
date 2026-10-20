# Release Notes 0.2.9

## Highlight

- Fixed #12: reducer replay no longer deep-clones accumulated event history before immediately replacing that cloned history.

## Large-Session Replay

Each non-snapshot transition still deep-clones mutable task state before applying the event, preserving rejection isolation and immutable reducer behavior. The clone now receives an empty `events` array because event history is append-only and is rebuilt from the prior history plus the current event after a successful transition.

This removes repeated cloning of historical event payloads during branch replay without changing persisted events, snapshot data, malformed-event handling, task validation, or completion gates.

## Regression Coverage

A deterministic reducer regression test verifies that:

- historical events are excluded from every transition clone;
- all prior events and the new event remain in order;
- historical event references retain the existing identity semantics;
- mutable task state remains isolated from the input state; and
- a rejected transition leaves the input state unchanged.

## Verification Status

- Passed the deterministic 500-event reproducer: the transition clone received zero historical events, returned 501 events in order, preserved historical references, and isolated mutable task state.
- Passed `PI_SDK_ROOT=/tmp/pi-tasks-sdk-1.2.0/node_modules/@earendil-works/pi-coding-agent npm run release:check` in both the release worktree and a fresh `v0.2.9` clone after `npm ci`: strict typecheck, Biome, 89 unit tests, 7 native Pi SDK tests, build, source/dist imports, pack dry-run, clean tarball install/import, and the audit gate.
- Passed real Pi 0.87.1 source dogfood with `openai-codex/gpt-5.6-sol`: task creation, update, evidence, completion, duplicate-evidence rejection, ordered-step rejection, decision/blocker rendering, same-session resume, and fork replay.
- Passed live Pi TUI `/tasks detail` rendering and clean `/quit`.
- Passed the fixed English and Traditional Chinese weak-model source prompts: compound-plan rejection, future-step evidence lock, 500-character evidence budget, and single-tool `task_next` convergence. The fixed installed-package English prompt also returned structured `task_plan` recovery.
- Passed installed `pi-tasks-0.2.9.tgz` extension smoke: `task_resume` reported the empty initial state and `task_plan` persisted task `T1` with current step `T1-S1`.
