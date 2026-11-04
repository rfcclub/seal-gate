# Intent: A mutation probe that never ran a test pins nothing

## Raw Request
Thoor: "fix all di" (2026-11-04), after Coda's publish-readiness review in rfcclub/seal-gate#10.

## Problem
`checkTestPinsBehavior` treats every nonzero result as a killed mutation and reports `{ pinned: true }` when no mutation exits 0. Coda reproduced a false pin with the installed package: `run_command: ['/definitely/nonexistent/coda-test-runner', []]` returned `{"pinned":true,"survivors":[]}` although the runner failed with `ENOENT` and no test ran. A timeout, any other runner failure, or a test that already fails without a mutation produce the same false pin.

## Scope
`src/spec/mutation-probe.ts`: run the unmutated test first and require it to pass; a spawn error, a timeout, or a runner error on any run makes the outcome `{ skipped: true, reason }` (inconclusive), never `pinned: true`. `MutationProbeOpts` gains an optional `timeout_ms`, and `_runTest` may report `error`. `package.json`'s `test` script also runs `tests/spec/` and `src/drift/__tests__/`, which it skipped before.

## Non-Goals
New mutation operators, telling a syntax-breaking mutation apart from a real kill, changing Orca, publishing.

## Success Criteria
- SC-1: A runner that cannot start, or that times out, never yields `pinned: true`; the outcome is skipped with a reason.
- SC-2: A test that fails without any mutation makes the probe skipped, not pinned.
- SC-3: A runner error during a mutation run makes the probe skipped; a passing baseline whose mutations all fail is still `pinned: true`.
- SC-4: `bun run test` runs `tests/spec/` and `src/drift/__tests__/`.

## Intent Approval
Status: APPROVED
Approved by: Thoor, "fix all di" (Telegram, 2026-11-04), read by Aria as approval of the four review fixes
Date: 2026-11-04
