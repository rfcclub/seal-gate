# Intent: --help exits 0

## Raw Request
Thoor: "fix all di" (2026-11-04); Coda's review in rfcclub/seal-gate#10 noted that `seal --help` prints usage but exits 2.

## Problem
`usage()` always exits 2, so an explicit help request (`seal --help`, `help`, `-h`) is reported as a usage error.

## Scope
An explicit help request prints the usage and exits 0. A bare `seal`, an unknown command and a missing file keep exit 2.

## Non-Goals
Changing the usage text or the review commands.

## Success Criteria
- SC-1: `seal --help`, `seal help` and `seal -h` print the usage and exit 0; `seal` with no command and an unknown command still exit 2.

## Intent Approval
Status: APPROVED
Approved by: Thoor, "fix all di" (Telegram, 2026-11-04), read by Aria as approval of the review fixes
Date: 2026-11-04
