# Nexus continuation: bounded local rehearsal

Task: https://nexus.brooksmcmillin.com/task/7987

## Source and consumer boundaries

No existing pi-tasks setting disables mandatory injected planning guidance.
The enforcement found here was globally injected tool prose, not a file-edit
hook. `src/tools.ts` now scopes standalone-contract rules and tells Nexus users
that local records are optional. Pi-native prompt metadata and OMP descriptions
carry the exception; lazy controls retain short descriptions. The local reducer,
evidence validation and history format are unchanged.

Infra's `.pi/extensions/closeout/state.ts` separately required a Pi snapshot and
unfinished-local-task reconciliation. It now ignores that duplicate bookkeeping
when the current branch contains a successful routed TaskManager task observation.
This is a bookkeeping classification, **not** claim or execution authority.
Lifecycle violations and verification advisories still run independently.

The global Pi context source is `brooksmcmillin/dotfiles:.pi/agent/AGENTS.md`,
not a generated file in pi-tasks or infra. Its installed consumer is
`~/.pi/agent/AGENTS.md`. The companion infra workflow task owns workflow prose;
this change does not silently rewrite those separate workflows.

| Producer | Consumer | Effective refresh |
| --- | --- | --- |
| pi-tasks `src/tools.ts` | Package `dist/index.js`, Pi prompt rules and OMP descriptions | Build updated source, then `/reload` or new session |
| infra closeout source | Personally installed closeout package | Update installed source, then `/reload` or new session |
| dotfiles Pi AGENTS | Global context file | Apply the reviewed dotfiles source, then `/reload` or new session |

No history migration, ID mapping, import or synchronization framework is required.
Source publication is not installed rollout. Preserve existing user changes when
refreshing any checkout or installed context file.

## Reproduce

From a source checkout with development dependencies installed:

```sh
node --experimental-strip-types scripts/nexus-continuation-rehearsal.ts /absolute/path/to/changed/infra/.pi/extensions/closeout/state.ts
```

Observed locally on 2026-11-12: Node v24.21.0, pi-tasks package 0.3.1,
TypeScript 5.9.3, Vitest 5.0.5; installed host documentation was Pi 1.5.2.
The script composes the actual changed pi-tasks and closeout factories with two
isolated in-memory session branches. Session A creates an unfinished local plan,
then shuts down. Its branch accessor throws if used afterward. Session B reads a
disposable durable task/PR handoff, has no A plan history, and reaches its fixture
next action: verify head B rather than reuse head A evidence. A's history stays
unchanged. Real closeout accepts absent local plans and still rejects a synthetic
owned claim without its private receipt. Regression tests additionally cover stale
and malformed snapshots, denied task reads and retained readable history.

The semantic model, Git/GitHub, TaskManager transport and action selector are
explicit fixture boundaries. Authorization denial and obsolete-head selection are
fixture assertions, not live Nexus authorization tests. No production task/PR is
mutated, no model is called, and no installed rollout or general model recovery
performance is claimed. Existing lifecycle/receipt tests supply the independent
negative cases for actual closeout ownership and obsolete-head verification.
