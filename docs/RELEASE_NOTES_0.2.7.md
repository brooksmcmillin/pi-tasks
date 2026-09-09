# Release Notes 0.2.7

## Highlights

- Merged PR #6 to make fresh Pi sessions lean: only `task_plan` and `task_resume` start active when no pi-tasks state exists.
- Restored the available pi-tasks controls after successful task creation, task-bearing session replay, and session-tree navigation.
- Preserved explicit host ceilings and unrelated tools: Pi allowlists, exclusions, `noTools`, and foreign task-like tools remain authoritative.
- Upgraded Vitest to `5.0.0` after audit reported the vulnerable `@vitest/mocker` dependency chain in the previous test stack.

## Native Tool Activation

On native Pi hosts that expose `getActiveTools`, `getAllTools`, and `setActiveTools`, pi-tasks now reconciles only the tools it registered for the current extension API instance.

Fresh task-free sessions keep the entrypoint surface compact:

```text
task_plan
task_resume
```

After a task is persisted or restored, pi-tasks activates the available task controls without adding names outside the host's configured registry or removing unrelated active tools.

Older compatible hosts without native activation APIs keep the previous all-tools behavior and retain full tool guidance in descriptions.

## Verification Status

- Passed: security review found no concrete privilege-escalation, allowlist-bypass, denial-of-service, information-leak, prototype-pollution, path-injection, or unsafe-error-propagation issue in the PR #6 activation path.
- Passed: strict implementation review findings were resolved before merge: native test API mismatch, older-host prompt guidance preservation, native test release-gate coverage, package metadata cleanup, and audit failure.
- Passed: targeted native Pi SDK extension test with `PI_SDK_ROOT=/tmp/pi-sdk-llLMrY/node_modules/@earendil-works/pi-coding-agent`; fresh schema+description surface was `2969` chars and active task-state surface was `9266` chars.
- Passed: `npm run release:check` with `PI_SDK_ROOT=/tmp/pi-sdk-llLMrY/node_modules/@earendil-works/pi-coding-agent` after the 0.2.7 version bump; it covered typecheck, Biome check, unit tests, native Pi SDK extension tests, build, source/dist import smoke, pack dry run, clean tarball install smoke, and audit.
- Pending: manual `npm publish`.
