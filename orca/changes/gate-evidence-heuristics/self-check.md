# Self-Check

## Claims
- Unchanged context lines and @@ hunk headers no longer feed the risk classifier or the TW203/TW204 triggers; added and removed lines still do, removed auth code still escalates, and file header paths are kept, so a change in an auth path escalates even when its lines carry no auth word.
- A hunk ends at its header's line counts, so indented prose after a diff is classified (an auth keyword there gives TW205).
- A hunk header counts only right after a `+++` file header or the previous hunk of the same file, so an `@@` line in prose with no file header is not a hunk (Aura review).
- A context line of the reviewed output is dropped only when the evidence diff has the same context line, so prose dressed as a hunk (even right after a real hunk) is classified.
- evidence.regression with one assertion failed in RED and passed in GREEN (same test file and hash) satisfies TW203; mismatched names, hashes or statuses, and records without a test path, an assertion name or a 64-hex SHA-256, do not.
- A regression keyword in the test log alone no longer satisfies TW203; the finding names evidence.regression.

## Evidence
```json
[
  { "type": "file", "file": "orca/changes/gate-evidence-heuristics/.harness/red/red-2026-11-05.txt", "content": "RED before the change: the four spec scenarios failed with assertion errors; the three preservation tests passed" },
  { "type": "file", "file": "orca/changes/gate-evidence-heuristics/.harness/red/red-review-e3b4f31-2026-11-05.txt", "content": "RED for Coda's review findings at e3b4f31: auth-path and malformed-records failed with assertion errors before the fix" },
  { "type": "file", "file": "orca/changes/gate-evidence-heuristics/.harness/red/red-review3-a38ab1b-2026-11-05.txt", "content": "RED for the review of a38ab1b: prose-after-hunk failed with an assertion error" },
  { "type": "file", "file": "orca/changes/gate-evidence-heuristics/.harness/red/red-review4-3857767-2026-11-05.txt", "content": "RED for Aura's review of 3857767: hunk-without-file-header failed with an assertion error (10 pass, 1 fail)" },
  { "type": "file", "file": "orca/changes/gate-evidence-heuristics/.harness/red/red-review5-8fe2475-2026-11-05.txt", "content": "RED at 8fe2475: fake-hunk-after-hunk failed with an assertion error (11 pass, 1 fail)" },
  { "type": "command", "command": "orca record-red gate-evidence-heuristics", "exit_code": 0, "output": "Coverage: 0% (0/8) Verdict: RED_RECORDED (re-recorded at 8fe2475 plus the new test)" },
  { "type": "command", "command": "bun run test (full test suite)", "exit_code": 0, "output": "281 pass, 1 skip, 0 fail; lyra 8 pass / 0 fail. Regression scenarios failed before the fix and pass after it." },
  { "type": "command", "command": "npx vitest run", "exit_code": 0, "output": "Test Files 6 passed | 1 skipped; Tests 55 passed | 1 skipped" },
  { "type": "command", "command": "orca verify gate-evidence-heuristics", "exit_code": 0, "output": "Coverage: 100% (9/9) Verdict: PASS" },
  { "type": "command", "command": "node tw-repro.mjs dist/index.js (issue repro)", "exit_code": 0, "output": "context-line-auth REVISE 85 TW203; red-green-no-word REVISE 85 TW203 (no TW205; TW203 because the repro passes no evidence.regression)" }
]
```

## Known Limitations
- Seal matches the records only; it cannot tell whether the GREEN run matches the current source. Orca passes only a verify receipt bound to the current source (rfcclub/orca#34).
- Callers that pass no evidence.regression now get TW203 on every bug fix, including ones whose log mentions a regression test.
- changedText recognises standard unified diffs (`+++` file header, then `@@ ... @@` hunks); a hunk header without a file header, and other diff formats, are judged as plain text, as before.
- record-red covers the first four scenarios (recorded before the first implementation). The two review scenarios were RED against the PR head e3b4f31 (auth-path passes on master, so it cannot be recorded there); their raw RED output is kept as a file.
- A caller that passes output but no evidence.diff gets every output context line judged, so context-only keywords can again raise findings for that caller.
