# Intent: reviewer verdict input boundaries

## Raw Request
Thoor, "ok làm đi em" (Telegram, 2026-11-06), after review of rfcclub/seal-gate#19 (Mira, Lila) found two regressions.

## Problem
1. `PolicyEngine.resolveVerdicts` and `worstOf` rank verdicts by literal name, so a caller or stored file that still says `ESCALATE_TO_HUMAN` ranks below everything and `['PASS','ESCALATE_TO_HUMAN']` resolves to `PASS`: an escalation becomes permission to proceed.
2. `normalizeVerdict` looks the alias up on a plain object, so `constructor`, `toString` and `__proto__` come back as functions or objects and `TrustMemory.fromJSON` stores them as verdicts.

## Scope
Normalize the old name at the public verdict-input boundaries before ranking. Accept only own alias keys.

## Non-Goals
Changing how unknown strings rank, scores, bands, or the other verdicts.

## Success Criteria
- SC-1: aggregation of verdicts that include the old name ranks it as `ESCALATE_TO_REVIEWER`.
- SC-2: prototype property names are not verdicts, in the normalizer or in restored trust memory.

## Intent Approval
Status: APPROVED
Approved by: Thoor, "ok làm đi em" (Telegram, 2026-11-06)
Date: 2026-11-06
