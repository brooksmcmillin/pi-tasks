# Pinned pickup producer

`index.ts` and `state.ts` are test-only copies from
`brooksmcmillin/infra/.pi/extensions/task-continuation/`.

- `index.ts`: commit `5055bf807cc3d907ce6d66a68088d3d5db190e49` (PR #8585,
  merged as `c0e72ef27d6d957654ac1065fc7b0e22b8de0e40`).
- `state.ts`: lifecycle-identity producer commit
  `ab299b247614ecec41937f50a000823c96dcce4f`
  ([PR #8607](https://github.com/brooksmcmillin/infra/pull/8607)), based on
  `1780b3e1901058725edc962c05aa949b017a065f`. Publication does not imply merge
  or runtime activation; full coordination requires both extension upgrades.
- Contract: `task-continuation:ownership` v1 with additive persisted
  `recovery: { inputId, owned }`; tested host: Pi 1.1.0.
- Only repository Biome formatting is applied; behavior is unchanged from the
  corresponding producer source. Fixture digests are checked in
  `test/unit/pickup-coordination.test.ts`.
- The owner authorized public redistribution of the producer files as fixtures
  and the cross-repository lifecycle update. New source adds only recovery
  metadata; no credentials, personal records or private endpoints are included.
- `historical.ts` retains the sanitized two-final fixture from the original
  commit. The original Linux session was unavailable locally; no tool responses,
  claim tokens or unrelated dialogue are included.

Both registration orders run against the real producer and pi-tasks on one
shared event bus. Controlled microtask completion after producer publication
exercises the boundary between individually awaited handlers. Tests include
checkpoint replay before/after release, new-input recovery and legacy parsing.
This is controlled lifecycle replay, not live provider or TaskManager testing.

Run `npm test -- --reporter=dot`. Fixtures require no infra checkout or network
and are excluded from the npm package. Do not independently edit their logic;
update source provenance, digests and replay evidence together when upgrading.

`PI_SDK_ROOT=<Pi 1.1.0 SDK directory> npm run test:native` also loads both real
entrypoints through Pi's loader with an offline scripted provider, including
inter-handler completion and exactly one advisory on fresh standalone input.
