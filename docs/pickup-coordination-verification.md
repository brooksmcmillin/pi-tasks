# Pickup coordination verification

## Scope and producer

The optional consumer coordinates with `task-continuation:ownership` v1 plus
additive persisted `recovery: { inputId, owned }`. The upgraded producer source,
fixture provenance, digest checks, and sanitized historical text are recorded in
`test/fixtures/infra-task-continuation/`. The owner authorized publishing the
reviewed producer files as test fixtures. They are not shipped in the npm package.

## Automated checks

Verified locally with Node 26.8.1 and Pi SDK 1.1.0:

| Check | Result |
| --- | --- |
| `npm test -- --reporter=dot` | 385 tests passed |
| `PI_SDK_ROOT=<Pi SDK directory> npm run test:native -- --reporter=dot` | 15 tests passed |
| `npm run typecheck` | Passed |
| Biome check on repository source/test/docs paths | Passed |
| `node --experimental-strip-types -e "import('./index.ts')"` | Passed |
| `npm pack --dry-run` (including TypeScript build) | Passed |
| `git diff --check` | Passed |

The unit suite runs both extension registrations in both orders on one event
bus. It executes real task tools, persists custom entries and replays active
ancestry. Cases include discovery before claim, pickup-to-plan handoff, active
open steps, evidence-backed task completion plus explicit pickup completion,
blocker/decision/wait dispositions, user stop/redirection, async notifications,
queued continuations/messages, abort/provider error suppression, reload, branch
switches and spent budgets surviving status reads and repeated pickup signals.
Controlled async completion before/after dispatch and in a microtask between
producer publication and consumer reset covers interactive/RPC/extension input,
branch replay, restart and repeated session start. Released checkpoint replay
retains ownership; fresh-input/standalone-branch cases reject stale ownership.
The original inter-handler regression failed in both registration orders before
the consumer consumed the upgraded producer metadata.

Native tests load both real entrypoints through Pi's resource loader and use a
scripted in-process provider: pickup, progress-only stop, one recovery, plan,
second stop, one non-continuing stall diagnostic. Both registration orders make
exactly four provider-function calls; neither emits a pi-tasks advisory or an
extra request. Additional native cases finish async work after input dispatch
and between individual awaited handlers, asserting no advisory in either order
and one advisory on the next fresh input. No live provider, TaskManager or deployment is involved.

## Real TUI smoke

A disposable offline Pi 1.1.0 TUI loaded the source extension through a local
command harness, with isolated agent/cwd/session directories and no credentials
or model calls. It verified:

- Task creation and update through registered tools.
- Actual `/tasks` output and task widget.
- Tree navigation to the pre-task entry, no active task there, then restoration
  on the task-bearing branch.
- Quit and resume of the exact persisted session.
- Fork into a distinct session with the same task contract.
- Three clean `/quit` shutdowns, each with process exit 0.

Local evidence: `/tmp/pi-pickup-dogfood/evidence.jsonl`, `exits.log`,
`tasks-screen.txt`, `resume-screen.txt`, `fork-screen.txt` and persisted sessions.
This TUI smoke verifies ordinary task lifecycle, not model reasoning or two-owner
settlement; the latter is covered by the native scripted-provider tests above.
No runtime activation, npm release or live service verification is claimed.

## Compatibility boundary

The v1 producer is cooperative: the workflow must register pickup before plan
work and explicitly update blocker/decision/wait/complete/stop dispositions.
Pi task state does not update TaskManager or infer the producer's lifecycle.
The producer owns and persists the per-input latch; the consumer does not infer
registration order or copy upgraded ownership into its own sent budget. Legacy
v1 producers lack this guarantee across lifecycle/inter-handler boundaries.
Legacy producer checkpoints migrate from current ownership only; already
released historical ownership cannot be reconstructed. Full coordination requires
updating both extensions, without activating either runtime as part of these tests.
Reverse budget transfer after a standalone pi-tasks nudge is not a v1 feature.
Unsupported signals cannot erase a valid ownership state; absent a producer,
standalone pi-tasks behavior remains available. See README for disable guidance.
