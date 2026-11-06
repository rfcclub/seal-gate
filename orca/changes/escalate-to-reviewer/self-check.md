# Self-Check

## Claims
- `ESCALATE_TO_HUMAN` is renamed to `ESCALATE_TO_REVIEWER` in `src`, `hooks`, the existing tests and fixtures, `USAGE.md` and the seal skill doc. Scores, bands and detectors are unchanged.
- `normalizeVerdict` is the single read boundary: the old name maps to the new one, other names are rejected. `TrustMemory.fromJSON` uses it, so stored history keeps counting.
- The three stop hooks stop on either name.
- `NEXT_ACTION` for the verdict now says to hand the evidence to an independent reviewer.

## Evidence
```json
[
  { "type": "file", "file": "orca/changes/escalate-to-reviewer/.orca-red.json", "content": "RED against pre-fix src with a stub normalizeVerdict: 3 assertion failures" },
  { "type": "command", "command": "orca record-red escalate-to-reviewer", "exit_code": 0, "output": "Verdict: RED_RECORDED" },
  { "type": "command", "command": "bun run test", "exit_code": 0, "output": "272 pass, 0 fail" },
  { "type": "command", "command": "bunx tsc --noEmit && bun run build", "exit_code": 0, "output": "no errors" },
  { "type": "command", "command": "orca verify escalate-to-reviewer", "exit_code": 0, "output": "Coverage: 100% (3/3) Verdict: PASS" }
]
```

## Known Limitations
- Orca (`rfcclub/orca`) still carries its own copy of the name in `pipeline-gate.ts` and `types.ts` and depends on this package; it needs this change released and its own change. Until then orca prints the old name or fails on the new one.
- Old verdict files in other repositories (`.harness/gate-verdicts`, `trust-memory.json`) are not rewritten; readers must use `normalizeVerdict`.
- `SCHEMA_VERSION` is unchanged (a value was renamed, no field added or removed). A consumer that matches the old name literally breaks until updated.
- Hooks were edited but not run.

## Unresolved
- `orca gate-code` reads `git diff HEAD`; run on already committed code it reviews an empty diff (hash e3b0c442...) and its PASS means nothing. I re-ran it on the full branch diff (soft-reset to the merge base, restored afterwards): `ESCALATE_TO_HUMAN` (the installed orca still prints the old name), trust 55, two findings.
- TW203 "bug fix without regression test evidence" is a keyword match on "fix" in the diff against a test log without the word "regression". This change is a rename; its tests are `tests/spec/escalate-to-reviewer.test.ts`. The later fix commit has its own regression tests in the change `reviewer-verdict-boundaries`.
- TW205 "auth-related change without unauthorized/forbidden test evidence" is a keyword match (risk rule RK-HIGH). Nothing here touches authentication or authorization: the only auth words in the diff are in prose that quotes this very finding. Not overridden; independent review is requested on the PR.
