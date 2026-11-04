# Self-Check

## Claims
- `checkTestPinsBehavior` runs the unmutated test once before any mutation. If it cannot run, or fails, the result is `{ skipped: true, reason: 'inconclusive: baseline …' }`.
- The default runner marks a runner failure separately from a test failure: a string `err.code` (`ENOENT`), a kill or signal (which is how a timeout ends), or a missing code sets `error`. A numeric nonzero exit is still a test failure, which counts as a killed mutation.
- A runner `error` during a mutation run restores the file (the existing `finally`) and returns skipped. `pinned: true` therefore needs a passing baseline and every mutation run to end in a real test failure.
- A mutation run counts as a kill only if it exits 1 and its output matches `failure_pattern` (default `DEFAULT_FAILURE_PATTERN`, now exported: a line that starts, after optional whitespace and an optional `error: `, with `AssertionError` or `expect(received)`; ANSI colour codes are removed first. Test names, Bun's `(fail) ` line and source excerpts are not evidence). Other failing runs are not counted, whether a missing tool, a crash, or a mutation that breaks the syntax. `pinned: true` needs no survivor and at least one counted kill; with no counted kill the probe is skipped.
- Review round 1 (Coda, #11): after a passing baseline, a runner whose required child executable was missing exited 127 on every mutation, and that was still reported as `pinned: true`. `mutation-tool-failure` covers it with the real default runner.
- Review round 2 (Coda, #11): Bun prints `(fail) ` for any thrown error, so a real Bun test that threw ENOENT after mutation still counted as a kill. `(fail) ` was removed from the default pattern, and `real-bun-non-assertion` covers it with real `bun test`.
- Review round 3 (Coda, #11): naming a test `expect(received) reports missing tool` made a zero-assertion ENOENT match, because the words appeared in the `(fail)` line. The pattern is now anchored to diagnostic lines. `assertion-word-in-test-name` covers it with real `bun test`, and a pattern test checks real Vitest and Bun lines.
- If the passing baseline's own output already matches the failure pattern, the probe is skipped: logged text cannot be told apart from a diagnostic.
- Review round 4 (Coda, #11): a real Bun test logged `console.error('AssertionError: logged fixture data')` in its passing baseline; its mutation threw ENOENT, and the logged line counted as a kill. `baseline-prints-evidence` covers it with real `bun test`.
- `MutationProbeOpts.timeout_ms` (default 60s) sets the default runner's timeout, and `_runTest` may return `error`.
- The `test` script now also runs `tests/spec/` and `src/drift/__tests__/`. `vitest.config.mjs` includes `tests/spec/**` for Orca's executable evidence.

## Evidence
```json
[
  { "type": "file", "file": "orca/changes/mutation-probe-inconclusive/.harness/red/red-2026-11-04.txt", "content": "RED before the change: 5 fail (runner-missing, runner-timeout, mutation-runner-error, baseline-failing, baseline-then-kills)" },
  { "type": "command", "command": "orca record-red mutation-probe-inconclusive", "exit_code": 0, "output": "Verdict: RED_RECORDED (5 scenarios)" },
  { "type": "file", "file": "orca/changes/mutation-probe-inconclusive/.harness/red/red-kill-evidence-2026-11-04.txt", "content": "RED for all seven scenarios against master's mutation-probe.ts: 7 (fail)" },
  { "type": "command", "command": "bun run test", "exit_code": 0, "output": "268 pass, 1 skip, 0 fail; 8 pass / 0 fail" },
  { "type": "command", "command": "npx vitest run", "exit_code": 0, "output": "42 passed, 1 skipped" },
  { "type": "command", "command": "npx tsc --noEmit -p .", "exit_code": 0, "output": "" },
  { "type": "command", "command": "orca verify mutation-probe-inconclusive", "exit_code": 0, "output": "Coverage: 100% (10/10) Verdict: PASS" }
]
```

## Known Limitations
- The kill evidence is still a text pattern. A test that prints assertion-like text **only** on the mutated path, or throws a non-assertion error whose message starts with `AssertionError`, still counts; in both cases the test itself produces the text. A runner-level structured report (per-assertion results) would be needed to close this completely.
- The `DEFAULT_FAILURE_PATTERN` unit test lives in `tests/spec/failure-pattern.test.ts`, so `tests/spec/mutation-probe.test.ts` still loads on master for `record-red`. A custom runner whose failures don't match the default pattern makes every probe skipped until `failure_pattern` is set. Either way it fails toward inconclusive, never toward a false pin from a silent tool failure.
- RED for round 2 was recorded against master's `mutation-probe.ts` (8 fail).
- `real-runner-pin` runs real `bun test`; one of its three mutations (`=>` to `= <`) breaks the syntax and is now not counted, while the other two are evidenced kills.
- The second RED was recorded by restoring master's `mutation-probe.ts` for one run; all seven scenarios fail on that code.
- Two existing tests relied on an always-failing runner to mean "pinned". `validateWithProbe` "leaves a pinned test…" and checkTestPinsBehavior "reports pinned:true…" now use a runner that passes the unmutated source, which is what a pin requires. The second one also used to pass without asserting anything (`if ('pinned' in res)`); it now asserts `{ pinned: true, survivors: [] }`.
- The probe now runs the test once more (the baseline), which adds one test run per probe.
- Orca's `src/types/seal-gate.d.ts` does not declare `timeout_ms` or `error` yet. Both are optional and Orca already handles `skipped`, so no Orca change is needed for correctness.

## Unresolved Assumptions
- Node's `execFile` sets `killed`/`signal` on a timeout on both macOS and Linux; only macOS was observed.

## Gate result
- `orca gate-plan`: PASS (100). `orca gate-code`: **ESCALATE_TO_HUMAN (75)**. The only blocking issue is `TEST_GAP: Auth-related change detected but no unauthorized/forbidden test evidence`, raised by the keyword heuristic: the new fixtures copy the existing `// guard` comment. The change touches no auth code. It is recorded as the gate returned it, not reworded to pass, and left for human review.
