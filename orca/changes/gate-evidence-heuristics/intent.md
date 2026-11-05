# Intent: Gate evidence heuristics judge changed code and recorded evidence

## Raw Request
Thoor: "log lỗi cho gate đi em, Aria bên Pi phàn nàn quá", then "ok nàng làm đi" (Telegram, 2026-11-05) for rfcclub/seal-gate#16 and rfcclub/seal-gate#17.

## Problem
- The risk classifier and the bug-fix trigger scan the whole unified diff, including unchanged context lines. A comment such as `// admin users ...` three lines from the edit escalates to a human (TW205), and `fix` in a context line raises TW203 (#17).
- TW203 is satisfied only by words such as `regression` in the test log. A recorded fail-before / pass-after run of the same assertion gets REVISE; adding the word gets PASS (#16).

## Scope
- Unchanged context lines and diff headers of a unified diff no longer feed the risk classifier or the bug-fix and retry triggers. Added and removed lines still do; removing auth code still escalates.
- `evidence.regression` carries structured RED and GREEN assertion records. TW203 is satisfied when the same assertion in the same test file content failed in RED and passed in GREEN.
- A keyword in the test log alone no longer satisfies TW203; the finding states which evidence is missing.

## Non-Goals
- Dropping TW203 or TW205, or lowering their severity.
- Verifying that a GREEN record matches the current source; the caller (Orca) passes only fresh receipts.

## Success Criteria
- SC-1: an `admin` or `fix` token only in an unchanged context line raises neither TW205 nor TW203.
- SC-2: matching RED/GREEN assertion records satisfy TW203 without any keyword.
- SC-3: a test log with `regression` but no structured evidence still raises TW203, and the finding names `evidence.regression`.

## Intent Approval
Status: APPROVED
Approved by: Thoor, "ok nàng làm đi" (Telegram, 2026-11-05)
Date: 2026-11-05
