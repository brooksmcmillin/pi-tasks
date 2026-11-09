# Review and publication task contracts

These are authoring examples, not execution permission or preapproved atomicity.
Replace the example repository, refs, manifest, run and receipt paths with verified
scope. Select only the deliverables the user requested. Use `task_rework` for
new review findings and `task_replan` to replace mistaken open planning entries;
do not create a second active task just to use this example. Both still require
native assessment. Never supply reducer-owned atomicity or assessment fields.

## Boundaries

- A verification bundle establishes **one named claim about one fixed candidate
  or retained run**. Several read-only commands or assertions can support it.
  Preserve every failed or unknown check; one report does not make unrelated
  correctness, deployment and operational claims one deliverable.
- Candidate capture is a parent-owned mutation. Staging or `git write-tree` is not
  a read-only reviewer check. Capture once after validation with exclusive writer
  ownership; child identity checks must not write the index.
- Dispatch is one operation with a run receipt, not a completed review. An unknown
  run state is a wait, never permission to launch another child. Record unresolved
  waits with `task_update.blocker`; checkpoint metadata alone is not a wait.
- Assess completed reviews separately. Missing output, identity mismatch or failed
  execution cannot count as a clean review. Repairs use `task_rework`, not a hidden
  repair loop in the result-assessment step.
- Keep audit-ledger persistence, commit, push and PR creation separate. Each can
  include its immediate preconditions and receipt/readback checks. Preparing a PR
  description belongs with that PR creation, not an artificial writing step.
- Permission, ownership, freshness, required validation and rollout gates remain
  mandatory at execution. A plan, passing evidence, template or old receipt grants
  none of them. Commit requires a reviewed candidate; push requires the authorized
  destination and fresh overlap discovery. PR creation requires another fresh
  overlap check. Neither push nor an open PR means merged delivery.

## Example `task_plan` payload

This fictional contract assumes the requested review and feature-branch publication
are authorized and that `/tmp/review-R17/contract.json` names the validated candidate,
selected review tracks, existing workflow, acceptance criteria and allowed files.
The parent must stop if those assumptions are not true. The dispatched run identity
is recorded in the named receipt; it is not guessed in advance.

```json
{
  "title": "Review and publish the R17 candidate",
  "objective": "Review the validated R17 candidate in example/widget, branch fix/r17, under /tmp/review-R17/contract.json, then publish a draft PR to main. No merge, deployment, force push or additional fixes.",
  "acceptance_criteria": [
    "The captured candidate identity matches the validated files and contract.",
    "Authorized review tracks completed against that candidate and their dispositions are retained.",
    "Separate commit, push and draft PR receipts identify the reviewed tree and exact published head."
  ],
  "plan_steps": [
    {
      "text": "Capture the validated R17 candidate for independent review.",
      "expectedOutput": "An immutable /tmp/review-R17/identity.json bundle containing the staged tree, HEAD, delta and contract/input hashes for the validated files.",
      "criterionRefs": [1],
      "allowedActions": ["Verify exclusive parent writer ownership and validation identity; stage only the contract's allowed files and capture the candidate bundle, checking its hashes. No dispatch or commit."]
    },
    {
      "text": "Establish whether the frozen R17 candidate still matches its identity manifest.",
      "expectedOutput": "One read-only identity verdict covering HEAD, index tree, unstaged paths and input hashes against /tmp/review-R17/identity.json, retaining discrepancies.",
      "criterionRefs": [1],
      "allowedActions": ["Compare Git identity and input hashes without writing the index; save one verification bundle. No staging, ledger update or dispatch."]
    },
    {
      "text": "Dispatch the authorized R17 candidate review through the existing workflow once.",
      "expectedOutput": "One /tmp/review-R17/dispatch.json receipt naming the exact run identities and candidate manifest; no completion claim.",
      "criterionRefs": [2],
      "allowedActions": ["Revalidate authority, candidate identity and existing run state; dispatch only the contract's authorized tracks when no live or unknown duplicate exists, and retain the returned receipt."]
    },
    {
      "text": "Assess the completed R17 review results against the frozen candidate.",
      "expectedOutput": "One /tmp/review-R17/results.json assessment showing each required track's terminal execution, output identity and findings, with missing or failed results explicit.",
      "criterionRefs": [2],
      "allowedActions": ["Read the retained runs and outputs from dispatch.json and compare them to identity.json; save the assessment without relaunch, repairs or ledger writes. Wait if a run is not terminal."]
    },
    {
      "text": "Persist the assessed R17 review dispositions in the existing audit ledger.",
      "expectedOutput": "A lock/CAS write receipt whose ledger readback retains results.json, candidate identity and each finding disposition without replacing unrelated records.",
      "criterionRefs": [2],
      "allowedActions": ["Revalidate candidate and expected ledger version; persist the assessed dispositions under the existing lock/CAS and verify readback. No new findings repairs or publication."]
    },
    {
      "text": "Commit the reviewed R17 candidate locally.",
      "expectedOutput": "A local commit receipt whose tree equals /tmp/review-R17/identity.json's reviewed staged tree.",
      "criterionRefs": [3],
      "allowedActions": ["Verify required review and validation gates, writer authority and unchanged staged identity; commit only that candidate and verify its tree. No push."]
    },
    {
      "text": "Push the reviewed R17 commit to example/widget branch fix/r17.",
      "expectedOutput": "A remote-ref receipt confirming fix/r17 equals the exact reviewed local commit.",
      "criterionRefs": [3],
      "allowedActions": ["Refresh open-PR overlap, destination, authority and candidate checks; fast-forward push that commit to the verified feature ref and confirm the remote SHA. No force push or PR creation."]
    },
    {
      "text": "Create the R17 draft PR from fix/r17 to main in example/widget.",
      "expectedOutput": "A draft PR receipt with URL and matching published head/base, describing the verified scope, validation limitations and remaining delivery gates.",
      "criterionRefs": [3],
      "allowedActions": ["Refresh overlap and publication authority; prepare the description from verified evidence, create the draft PR and verify its head/base. No merge or deployment."]
    }
  ]
}
```

These eight steps deliberately do not certify code correctness from identity
checks. Required implementation validation belongs in its own bounded deliverable
or existing verified gate. A candidate-only review cannot replace any required
published-head validation. Add that outcome when required by the active workflow.

## Recovery after rejection

Use the returned issues to identify the missing target/result or independent
mutation. For example, split “commit and push the candidate” into the local-commit
and remote-push shapes above; split “launch reviewers and fix their findings” into
dispatch, completed-result assessment, and findings-driven `task_rework`. Do not
merely rename compound work a bundle or recursively split every Git read. If the
missing element is a human decision, record the blocker instead of guessing it.

## Verification limits

Unit fixtures exercise transport, decision preservation, schemas and reducer gates
with controlled native-model responses. They do not prove model accuracy. The
historical formulation corpus is `test/fixtures/review-contract-cases.ts`; native
assessment results and call-count comparisons must report model/prompt versions,
actual decisions, failed attempts and whether counts are measured or hypothetical.
