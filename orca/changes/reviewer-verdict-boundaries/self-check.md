# Self-Check

## Claims
- `PolicyEngine.resolveVerdicts`, `worstOf` and `maxVerdict` read `ESCALATE_TO_HUMAN` as `ESCALATE_TO_REVIEWER` before ranking, so `['PASS','ESCALATE_TO_HUMAN']` resolves to `ESCALATE_TO_REVIEWER`.
- `normalizeVerdict` accepts only own alias keys; `constructor`, `toString`, `hasOwnProperty`, `__proto__` and `valueOf` give null and `TrustMemory.fromJSON` drops them.

## Evidence
```json
[
  { "type": "file", "file": "orca/changes/reviewer-verdict-boundaries/.orca-red.json", "content": "RED against the head of aria/escalate-to-reviewer: both assertions failed (PASS instead of ESCALATE_TO_REVIEWER; [class Object] instead of null)" },
  { "type": "command", "command": "orca record-red reviewer-verdict-boundaries", "exit_code": 0, "output": "Verdict: RED_RECORDED" },
  { "type": "command", "command": "bun run test", "exit_code": 0, "output": "274 pass, 0 fail" },
  { "type": "command", "command": "bunx tsc --noEmit && bun run build", "exit_code": 0, "output": "no errors" },
  { "type": "command", "command": "orca verify reviewer-verdict-boundaries", "exit_code": 0, "output": "Coverage: 100% (2/2) Verdict: PASS" }
]
```

## Known Limitations
- A value that is still not a verdict after normalizing keeps its old ranking (lowest in `worstOf`, ignored in `resolveVerdicts`); not changed here.
- Hooks were not run.
