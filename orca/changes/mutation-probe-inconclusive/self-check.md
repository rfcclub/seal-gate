# Self-Check

## Claims
- `checkTestPinsBehavior` runs the unmutated test once before any mutation. If it cannot run, or fails, the result is `{ skipped: true, reason: 'inconclusive: baseline …' }`.
- The default runner marks a runner failure separately from a test failure: a string `err.code` (`ENOENT`), a kill or signal (which is how a timeout ends), or a missing code sets `error`. A numeric nonzero exit is still a test failure, which counts as a killed mutation.
- A runner `error` during a mutation run restores the file (the existing `finally`) and returns skipped. `pinned: true` therefore needs a passing baseline and every mutation run to end in a real test failure.
- A mutation run counts as a kill only if it exits 1 and its output matches `failure_pattern` (default `DEFAULT_FAILURE_PATTERN`: `AssertionError`, `expect(received)` or a `(fail) ` line, now exported). Other failing runs are not counted, whether a missing tool, a crash, or a mutation that breaks the syntax. `pinned: true` needs no survivor and at least one counted kill; with no counted kill the probe is skipped.
- Review round 1 (Coda, #11): after a passing baseline, a runner whose required child executable was missing exited 127 on every mutation, and that was still reported as `pinned: true`. `mutation-tool-failure` covers it with the real default runner.
- `MutationProbeOpts.timeout_ms` (default 60s) sets the default runner's timeout, and `_runTest` may return `error`.
- The `test` script now also runs `tests/spec/` and `src/drift/__tests__/`. `vitest.config.mjs` includes `tests/spec/**` for Orca's executable evidence.

## Evidence
```json
[
  { "type": "file", "file": "orca/changes/mutation-probe-inconclusive/.harness/red/red-2026-11-04.txt", "content": "RED before the change: 5 fail (runner-missing, runner-timeout, mutation-runner-error, baseline-failing, baseline-then-kills)" },
  { "type": "command", "command": "orca record-red mutation-probe-inconclusive", "exit_code": 0, "output": "Verdict: RED_RECORDED (5 scenarios)" },
  { "type": "file", "file": "orca/changes/mutation-probe-inconclusive/.harness/red/red-kill-evidence-2026-11-04.txt", "content": "RED for all seven scenarios against master's mutation-probe.ts: 7 (fail)" },
  { "type": "command", "command": "bun run test", "exit_code": 0, "output": "264 pass, 1 skip, 0 fail; 8 pass / 0 fail" },
  { "type": "command", "command": "npx vitest run", "exit_code": 0, "output": "38 passed, 1 skipped" },
  { "type": "command", "command": "npx tsc --noEmit -p .", "exit_code": 0, "output": "" },
  { "type": "command", "command": "orca verify mutation-probe-inconclusive", "exit_code": 0, "output": "Coverage: 100% (7/7) Verdict: PASS" }
]
```

## Known Limitations
- The kill evidence is a text pattern, so a runner that prints `AssertionError` for something else and exits 1 is still counted. A custom runner whose failures don't match the default pattern makes every probe skipped until `failure_pattern` is set. Either way it fails toward inconclusive, never toward a false pin from a silent tool failure.
- `real-runner-pin` runs real `bun test`; one of its three mutations (`=>` to `= <`) breaks the syntax and is now not counted, while the other two are evidenced kills.
- The second RED was recorded by restoring master's `mutation-probe.ts` for one run; all seven scenarios fail on that code.
- Two existing tests relied on an always-failing runner to mean "pinned". `validateWithProbe` "leaves a pinned test…" and checkTestPinsBehavior "reports pinned:true…" now use a runner that passes the unmutated source, which is what a pin requires. The second one also used to pass without asserting anything (`if ('pinned' in res)`); it now asserts `{ pinned: true, survivors: [] }`.
- The probe now runs the test once more (the baseline), which adds one test run per probe.
- Orca's `src/types/seal-gate.d.ts` does not declare `timeout_ms` or `error` yet. Both are optional and Orca already handles `skipped`, so no Orca change is needed for correctness.

## Unresolved Assumptions
- Node's `execFile` sets `killed`/`signal` on a timeout on both macOS and Linux; only macOS was observed.

## Gate result
- `orca gate-plan`: PASS (100). `orca gate-code`: **ESCALATE_TO_HUMAN (75)**. The only blocking issue is `TEST_GAP: Auth-related change detected but no unauthorized/forbidden test evidence`, raised by the keyword heuristic: the new fixtures copy the existing `// guard` comment. The change touches no auth code. It is recorded as the gate returned it, not reworded to pass, and left for human review.
