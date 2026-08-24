# Release Notes 0.2.4

## Highlights

- Fixed Issue #3 by aligning `task_evidence` tool schema with runtime evidence quality gates for Oh My Pi and weak local models.
- Replaced weak-model-hostile conditional/root-`oneOf` evidence parameters with a flat OMP-compatible object schema.
- Required traceability fields at generation time: top-level `references` plus complete `quality` metadata.
- Kept command/test/dogfood rejection recovery copyable through `retry_example`.

## Issue #3 Fix

`task_evidence` now asks models for every field the reducer quality gate can require:

- `references`
- `quality.source`
- `quality.reproducible`
- `quality.verifier`
- `quality.command`
- `quality.artifactRefs`
- `quality.observedOutput`

For non-command evidence, `quality.command` is a verification-action label rather than a shell command.

## Weak-Model Dogfood

Validated with Oh My Pi and the local ornith1.5 model:

```text
llama.cpp/bartowski/Ornith-1.5-35B-A3B-GGUF:Q6_K_L
```

Evidence root:

```text
/private/tmp/pi-tasks-issue3-ornith15-fixed
```

Final transcript summary:

```text
/private/tmp/pi-tasks-issue3-ornith15-fixed/summary2.json
```

Observed results:

- Command evidence positive path accepted on the first `task_evidence` call.
- Recovery path used one rejected command-evidence call followed by one corrected accepted call.
- Test evidence accepted with complete quality metadata.
- Review evidence accepted with `quality.command` used as a verification-action label.
- Traditional Chinese command-evidence prompt accepted on the first call after `references` became schema-required.
- Duplicate rejected payload count was zero across final sessions.

## Verification Status

- Passed: `npm run release:check`.
- Passed: real Oh My Pi ornith1.5 weak-model dogfood for Issue #3.
- Passed: release audit after lockfile refresh.
- Pending: npm publish. The tarball is ready for manual `npm publish`.
