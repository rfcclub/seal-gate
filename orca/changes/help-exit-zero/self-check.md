# Self-Check

## Claims
- `usage(code = 2)` takes its exit code; `seal --help`, `seal help` and `seal -h` call `usage(0)`. A bare `seal` and an unknown command keep exit 2. `tests/cli/` was added to the `test` script and to `vitest.config.mjs` (this touches the same `include` line as #11, so whichever merges second needs a small rebase).

## Evidence
```json
[
  { "type": "file", "file": "orca/changes/help-exit-zero/.harness/red/red-2026-11-04.txt", "content": "RED before the change: the help flags exited nonzero" },
  { "type": "command", "command": "orca record-red help-exit-zero", "exit_code": 0, "output": "Verdict: RED_RECORDED" },
  { "type": "command", "command": "full test suite", "exit_code": 0, "output": "bun run test 207 pass / 1 skip / 0 fail plus the 8-case script; vitest run green; tsc clean" },
  { "type": "command", "command": "orca verify help-exit-zero", "exit_code": 0, "output": "Coverage: 100% (1/1) Verdict: PASS" }
]
```

## Known Limitations
- Only the exit code of an explicit help request changes; the usage text and other commands are unchanged.
