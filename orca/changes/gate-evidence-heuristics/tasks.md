# Tasks

- [x] G1 (SC-1, SC-2, SC-3): Add failing tests tests/gate/evidence-heuristics.test.ts; include tests/gate in the test script and vitest.config.mjs.
- [x] G2 (SC-1): changedText helper; use it in RiskClassifier and the TW203/TW204 triggers.
- [x] G3 (SC-2): SealEvidence.regression and hasRegressionEvidence satisfy TW203.
- [x] G4 (SC-3): Remove keyword-only acceptance; the finding names evidence.regression.
- [x] G6 (SC-1): Keep diff file paths for classification; only unchanged context lines and @@ headers are dropped (Coda review, auth-path).
- [x] G7 (SC-2): Validate record test, name and SHA-256 shape before matching (Coda review, malformed-records).
- [x] G5: Full tests, build, verify and gates; self-check.

## Locked criteria mapping
- SC-1: G1/G2 context-line-admin, context-line-fix.
- SC-2: G1/G3 structured-regression.
- SC-3: G1/G4 keyword-only.
