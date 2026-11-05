# Intent: ESCALATE_TO_REVIEWER replaces ESCALATE_TO_HUMAN

## Raw Request
Thoor (Telegram, 2026-11-05): "lâu dài phải sửa orca ... phải là ESCALATE_TO_REVIEWER, không phải HUMAN" — an uncertain gate hands the evidence to an independent reviewer; it does not default the work back to the human.

## Problem
The 30–49 verdict is named `ESCALATE_TO_HUMAN` and its next action says "requires human review". Agents read it as "stop and ask the user", which is the opposite of the colony's rule that independent reviewers examine the evidence first.

## Scope
Rename the verdict to `ESCALATE_TO_REVIEWER` everywhere seal-gate defines or reads it. Stored records and callers that still use the old name are read as the new one. Hooks stop on either name.

## Non-Goals
Changing scores, bands, which detectors escalate, or the other verdicts. Rewriting stored history files in other repositories. Orca's own use of the name (separate change in rfcclub/orca).

## Success Criteria
- SC-1: a score of 30–49 yields `ESCALATE_TO_REVIEWER`; `VERDICT_ORDER` and `NEXT_ACTION` use it and the next action names an independent reviewer.
- SC-2: `normalizeVerdict` maps the old name to the new one, keeps the other four, and rejects anything else.
- SC-3: trust memory stored with the old name loads as the new one; unknown names are still dropped.

## Intent Approval
Status: APPROVED
Approved by: Thoor, "nàng sửa luôn" (Telegram, 2026-11-05)
Date: 2026-11-05
