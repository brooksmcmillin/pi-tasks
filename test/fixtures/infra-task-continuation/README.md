# Pinned pickup producer

`index.ts` and `state.ts` are test-only copies from
`brooksmcmillin/infra/.pi/extensions/task-continuation/` at commit
`5055bf807cc3d907ce6d66a68088d3d5db190e49` (PR #8585, merged as
`c0e72ef27d6d957654ac1065fc7b0e22b8de0e40`).

- Contract: `task-continuation:ownership`, version 1; tested host: Pi 1.1.0.
- Only repository Biome formatting is applied; behavior is unchanged.
- Upstream SHA-256 (`state.ts`): `a05ad66dc0c8fde5e3baa67798c7e2eba8b1fcf966b8e52858ca9cb29d59d86a`.
- Upstream SHA-256 (`index.ts`): `8da6b5d9a86d7ae36da279cf52c0e8c832ba7738b3badc22a548192ef22f9397`.
- Fixture digests are checked in `test/unit/pickup-coordination.test.ts`.
- The repository owner explicitly authorized public redistribution of these two files as test fixtures.
- Source: https://github.com/brooksmcmillin/infra/blob/5055bf807cc3d907ce6d66a68088d3d5db190e49/.pi/extensions/task-continuation/state.ts
- `historical.ts` copies only the sanitized two-final fixture from that commit's
  `scripts/tests/pi_task_continuation.test.ts`. The original Linux session was
  not available locally. No tool responses, claim tokens or unrelated dialogue
  are included.

The two-extension tests register the real producer and pi-tasks on a synchronous
shared event bus and compose settlement entries/continuation in load order.
Tools execute against branch-local persisted custom entries. Both registration
orders are exercised, including reload and alternate ancestry. This is a
controlled lifecycle replay, not a live provider or TaskManager test, and does
not prove semantic classification of assistant prose.

Run `npm test -- --reporter=dot`. No network, infra checkout, runtime SDK import,
TaskManager connection or deployment is needed. Type-only SDK imports in the
fixture are erased by the test runner. Do not change the pinned producer's logic;
when upgrading it, update the commit, digests, contract notes and replay evidence
together. Fixtures are not included in the published npm package.

`PI_SDK_ROOT=<Pi 1.1.0 SDK directory> npm run test:native` additionally loads both
real extension entrypoints through Pi's loader, using a scripted in-process
provider. In each registration order it verifies pre-claim recovery followed by
`task_plan`, exactly one nudge, one stall diagnostic and no extra model request.
