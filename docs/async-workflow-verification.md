# Async workflow advisory regression verification

## Reproduced defect and bounded repair (2026-10-08)

Independent review found that the initial eight passing seam tests assigned the
same synthetic identity to both extensions, masking a real integration defect.
The producer's `src/shared/session-identity.ts:resolveCurrentSessionId` prefers
`getSessionFile()` over `getSessionId()`; the workflow executor uses that resolver.
The consumer previously accepted only `getSessionId()`. For persisted sessions,
file path and UUID differ, so starts were ignored and redundant advice followed.

The corrected test executes the actual producer resolver with distinct UUID/file
values. Before production edits, six of eight integration cases failed across
source and installed dist; the two no-work controls passed. A native Pi persisted
session test also failed, as did two new unit identity cases. The minimal repair
accepts either exact nonempty current-session UUID or file path. It does not
normalize paths, infer identity from basenames, change blockers, add polling, or
change the producer. Existing UUID-only compatibility and foreign rejection remain.

## Runtime provenance

| Component | Inspected version / revision | Entrypoint |
| --- | --- | --- |
| Pi | 1.1.0; Node 26.8.1 | Installed release 1.1.0; `pi --version` agrees |
| Installed pi-tasks baseline | 0.2.7; `b420e1897f89e21321e92bc3993fcf685b1cd0a3` | Manifest selects `dist/index.js`; still unfixed/read-only |
| Candidate pi-tasks | Same base plus this patch | Source and newly built local `dist/index.js` |
| pi-subagents | 0.76.1; `176b896505b4063c8f0d08f24e81290a33e3f94d` | Manifest selects `index.ts`, normally loading `src/extension/index.ts` |

Personal configuration includes both git packages. The producer is clean. The
installed consumer's unrelated modified `package-lock.json` was untouched. Before
repair its entire dist tree matched the local build. After repair, entrypoint
SHA-256 identities distinguish the fixed candidate from the installed baseline:

- Installed: `0a02082eb2b87d6f99e9d400357f507f15c5ff8dabacaea02eb72f9505273ce5`.
- Candidate: `94580914e2f6e429c984dd1041eeeb5dab02a0b6ef8e8fbee8114778218827f1`.

These identify fresh-load files, not module caches in running processes. No
installed package or settings were modified; publication/runtime activation is
separate. Package versions alone are insufficient because fork revisions retain
the same version.

## Reproducible lifecycle seam

```sh
npm ci --offline --ignore-scripts
PI_SUBAGENTS_ROOT=/path/to/pi-subagents \
PI_TASKS_INSTALLED_ROOT=/path/to/unfixed/installed/pi-tasks \
  npm run test:async-workflow -- --reporter=dot
```

The command builds the candidate before running `test/async-workflow.test.ts`.
Missing paths, producer revision/source drift, or baseline entrypoint digest drift
fail rather than skip. Like `test:native`, this is an explicit integration gate,
separate from `npm test`. It downloads nothing and launches no workers/models.
Future producer/baseline changes require deliberate provenance review.

The real producer resolver supplies all start/completion and notifier identities.
TypeScript parses and executes the unique emission call at each pinned seam:

| Event | Producer source under `src/` |
| --- | --- |
| Root start (`mode: workflow`) | `runs/foreground/subagent-executor.ts`: `deps.pi.events.emit` |
| Child start (`mode: single`, `parentWorkflowRunId`) | `runs/background/async-execution.ts`: `ctx.pi.events.emit` |
| Awaited child completion | Executor's `emitWorkflowAwaitedChildComplete` emission |
| Root completion | `runs/background/result-watcher.ts` completion emission |

Actual `notify.ts`, `control-notices.ts`, `subagent-control.ts`, and `parent-wake.ts`
modules handle delivery. Root notification precedes completion publication,
matching the watcher's accepted-delivery order. Existing producer test options
disable batching and isolate the send registry; the wake clock is fixed. Pi API
doubles capture notices/wakes and dispatch callbacks. Real task tools arm advice.

Sixteen candidate cases cover source/build, each with UUID-only and persisted-file
identity. Two separate baseline controls assert the known installed defect:
UUID-only suppresses; persisted-file emits unwanted advice. Candidate cases prove:

- Root-only, overlapping root/child, and root still running after child completion
  suppress repeated advisories across input/tree replay.
- Genuine supervisor attention delivers one deduplicated notice and idle-parent
  steer wake. Consuming that wake retains the running-work wait.
- Awaited child completion clears its run but intentionally does not notify the
  parent: the workflow owns that child's result.
- Root completion delivers one notice/wake despite direct delivery plus event
  publication. Pending wake takes precedence over advice; after consumption, the
  cleared runs no longer suppress ordinary eligible advice.
- Root-first completion cannot release a still-tracked child; foreign completion
  cannot clear it. No-work advice remains once per eligible input.

The main lifecycle exercises both producer-notifier/consumer registration orders.
Unit tests additionally cover both aliases on a persisted host, missing/empty
identity, file-only hosts, exact foreign rejection, and identity replacement on
session start. The native suite now includes actual Pi file-path identity at the
settlement boundary, alongside its existing UUID cases.

## Historical observations and limits

Bounded inspection of session prefix `01a11826` found workflow results at lines
60/149, yield checks at 62/151, and waiting responses at 63/152. Advisory timestamps:
2026-10-07T20:58:40.475Z and 2026-10-07T22:28:51.283Z. Independent review also observed
this task's parent reporting active work before a yield check, with the worker's
run artifact identifying the parent by file path rather than UUID. No private
transcript content is retained here.

Consumer suppression originated in `0e07c46` before those historical observations.
Current installed HEAD also includes later pickup coordination (#27) and handoff
(#28). Reflog/commit dates do not identify historically loaded builds. The fresh
source/installed mismatch is now independently reproduced and consistent with the
observed symptom; it is not proof of exclusive historical cause or live bus state.

This remains **contract-seam coverage**, not full producer orchestration:

- Launching, child processes, filesystem/result watching, ownership recovery,
  batching timers, and supervisor-request creation are not executed. Their inputs
  enter at documented seams; upstream reachability/order is not proved.
- Producer factory registration is inspected, not executed wholesale. Pi message
  consumption is simulated in the seam harness; the native suite separately runs
  actual settlement with a scripted local provider.
- Pre-subscription/reload-time runs, missing identity/event APIs, other providers,
  unrecorded waits, active-parent races, terminal child failures, and unrelated
  extensions remain outside the guarantee. Existing explicit-wait guidance applies.

## Validation and local logs

| Command / check | Final result |
| --- | --- |
| Focused gate above | 18 passed: 16 candidate cases + 2 baseline controls |
| `npm test -- --reporter=dot` | 394 passed |
| `PI_SDK_ROOT=<Pi 1.1.0 SDK> npm run test:native -- --reporter=dot` | 16 passed; local scripted providers |
| `npm run typecheck` | Passed (source scope; Vitest transpiles tests) |
| Source strip-types import and built dist import | Passed |
| `npm pack --dry-run` | Passed, including build; tests not shipped |
| Biome on changed code; `git diff --check` | Passed |
| Offline real Pi TUI on repaired source | Passed |

Fail-first logs under `/tmp/pi-async-workflow-`:
`identity-fail-first.log` (6 failed/2 passed), `native-fail-first.log` (1 failed,
15 filtered out), `unit-fail-first.log` (2 failed/58 passed). These preceded any
production edit. Passing logs: `identity-pass.log`, `native-pass.log`,
`unit-pass.log`. The initial test-only candidate's no-defect conclusion is
superseded by this identity-aware reproduction.

Fresh offline TUI invocations used isolated agent/cwd/session directories, no
credentials/model requests, and the source command harness. Registered tools
created/updated a task; `/tasks` rendered it. Tree navigation verified an empty
pre-task branch and restoration. Separate invocations resumed that session and
forked to a distinct one with the task intact. All three `/quit` exits returned 0;
startup evidence records distinct UUID/file identities. Scripts and evidence:
`/tmp/pi-async-workflow-rework-dogfood/{run.sh,harness.ts,evidence.jsonl,exits.log,tasks-screen.txt,resume-screen.txt,fork-screen.txt}`.
This is ordinary lifecycle dogfood, not live worker execution. Paid-model,
live-worker, network release, and deployment gates were not run.
