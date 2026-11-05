# Self-Check

## Claims
- Unchanged context lines and @@ hunk headers no longer feed the risk classifier or the TW203/TW204 triggers; added and removed lines still do, removed auth code still escalates, and file header paths are kept, so a change in an auth path escalates even when its lines carry no auth word.
- evidence.regression with one assertion failed in RED and passed in GREEN (same test file and hash) satisfies TW203; mismatched names, hashes or statuses, and records without a test path, an assertion name or a 64-hex SHA-256, do not.
- A regression keyword in the test log alone no longer satisfies TW203; the finding names evidence.regression.

## Evidence
```json
[
  { "type": "file", "file": "orca/changes/gate-evidence-heuristics/.harness/red/red-2026-11-05.txt", "content": "RED before the change: the four spec scenarios failed with assertion errors; the three preservation tests passed" },
  { "type": "file", "file": "orca/changes/gate-evidence-heuristics/.harness/red/red-review-e3b4f31-2026-11-05.txt", "content": "RED for Coda's review findings at e3b4f31: auth-path and malformed-records failed with assertion errors before the fix" },
  { "type": "command", "command": "orca record-red gate-evidence-heuristics", "exit_code": 0, "output": "Coverage: 0% (0/4) Verdict: RED_RECORDED" },
  { "type": "command", "command": "bun run test (full test suite)", "exit_code": 0, "output": "278 pass, 1 skip, 0 fail; lyra 8 pass / 0 fail. Regression scenarios failed before the fix and pass after it." },
  { "type": "command", "command": "npx vitest run", "exit_code": 0, "output": "Test Files 6 passed | 1 skipped; Tests 52 passed | 1 skipped" },
  { "type": "command", "command": "orca verify gate-evidence-heuristics", "exit_code": 0, "output": "Coverage: 100% (6/6) Verdict: PASS" },
  { "type": "command", "command": "node tw-repro.mjs dist/index.js (issue repro)", "exit_code": 0, "output": "context-line-auth REVISE 85 TW203; red-green-no-word REVISE 85 TW203 (no TW205; TW203 because the repro passes no evidence.regression)" }
]
```

## Known Limitations
- Seal matches the records only; it cannot tell whether the GREEN run matches the current source. Orca passes only a verify receipt bound to the current source (rfcclub/orca#34).
- Callers that pass no evidence.regression now get TW203 on every bug fix, including ones whose log mentions a regression test.
- changedText recognises standard unified diffs (`@@ ... @@` hunks); other diff formats are judged as plain text, as before.
- record-red covers the first four scenarios (recorded before the first implementation). The two review scenarios were RED against the PR head e3b4f31 (auth-path passes on master, so it cannot be recorded there); their raw RED output is kept as a file.
