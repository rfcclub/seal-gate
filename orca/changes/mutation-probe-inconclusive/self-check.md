# Self-Check

## Claims
- `checkTestPinsBehavior` runs the unmutated test once before any mutation. If it cannot run, or fails, the result is `{ skipped: true, reason: 'inconclusive: baseline …' }`.
- The default runner marks a runner failure separately from a test failure: a string `err.code` (`ENOENT`), a kill or signal (which is how a timeout ends), or a missing code sets `error`. A numeric nonzero exit is still a test failure, which counts as a killed mutation.
- A runner `error` during a mutation run restores the file (the existing `finally`) and returns skipped. `pinned: true` therefore needs a passing baseline and every mutation run to end in a real test failure.
- `MutationProbeOpts.timeout_ms` (default 60s) sets the default runner's timeout, and `_runTest` may return `error`.
- The `test` script now also runs `tests/spec/` and `src/drift/__tests__/`. `vitest.config.mjs` includes `tests/spec/**` for Orca's executable evidence.

## Evidence
```json
[
  { "type": "file", "file": "orca/changes/mutation-probe-inconclusive/.harness/red/red-2026-11-04.txt", "content": "RED before the change: 5 fail (runner-missing, runner-timeout, mutation-runner-error, baseline-failing, baseline-then-kills)" },
  { "type": "command", "command": "orca record-red mutation-probe-inconclusive", "exit_code": 0, "output": "Verdict: RED_RECORDED (5 scenarios)" },
  { "type": "command", "command": "bun run test", "exit_code": 0, "output": "261 pass, 1 skip, 0 fail; 8 pass / 0 fail" },
  { "type": "command", "command": "npx vitest run", "exit_code": 0, "output": "35 passed, 1 skipped" },
  { "type": "command", "command": "npx tsc --noEmit -p .", "exit_code": 0, "output": "" },
  { "type": "command", "command": "orca verify mutation-probe-inconclusive", "exit_code": 0, "output": "Coverage: 100% (5/5) Verdict: PASS" }
]
```

## Known Limitations
- A mutation that breaks the test file's syntax still counts as killed, because its exit code is numeric and nonzero. Telling that apart from a real assertion failure is out of scope.
- Two existing tests relied on an always-failing runner to mean "pinned". `validateWithProbe` "leaves a pinned test…" and checkTestPinsBehavior "reports pinned:true…" now use a runner that passes the unmutated source, which is what a pin requires. The second one also used to pass without asserting anything (`if ('pinned' in res)`); it now asserts `{ pinned: true, survivors: [] }`.
- The probe now runs the test once more (the baseline), which adds one test run per probe.
- Orca's `src/types/seal-gate.d.ts` does not declare `timeout_ms` or `error` yet. Both are optional and Orca already handles `skipped`, so no Orca change is needed for correctness.

## Unresolved Assumptions
- Node's `execFile` sets `killed`/`signal` on a timeout on both macOS and Linux; only macOS was observed.

## Gate result
- `orca gate-plan`: PASS (100). `orca gate-code`: **ESCALATE_TO_HUMAN (75)**. The only blocking issue is `TEST_GAP: Auth-related change detected but no unauthorized/forbidden test evidence`, raised by the keyword heuristic: the new fixtures copy the existing `// guard` comment. The change touches no auth code. It is recorded as the gate returned it, not reworded to pass, and left for human review.
