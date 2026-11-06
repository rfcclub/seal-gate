# Design

`changedText(text)` (src/detectors/diff-lines.ts) keeps text outside unified diffs as is; inside a hunk, which ends after the old/new line counts in its `@@` header, it keeps `+` and `-` lines and drops context lines, `@@` hunk headers and the `diff --git`, `index`, `---` and `+++` header lines. `RiskClassifier.classify` and the TW203/TW204 triggers in `TestWeaknessDetector` read `changedText` of their inputs. Plain text without hunks is unchanged, so plan review and non-diff callers behave as before.

`SealEvidence.regression?: { red: AssertionRecord[]; green: AssertionRecord[] }` with `AssertionRecord { test, name, status, test_sha256 }`. `hasRegressionEvidence` requires one RED record with status `failed` and one GREEN record with status `passed` for the same `test`, `name` and non-empty `test_sha256`. TW203 is satisfied only by that; the keyword match is removed (separate commit), and the finding text names `evidence.regression`. The caller is responsible for passing a GREEN record that matches the current source.

Tests in tests/gate/ run under Bun and Vitest; the script and vitest include add tests/gate.
