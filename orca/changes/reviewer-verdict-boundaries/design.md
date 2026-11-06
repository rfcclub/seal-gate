# Design
`normalizeVerdict` checks `Object.hasOwn(LEGACY_VERDICTS, value)` so only the one alias key counts. `worstOf` and `PolicyEngine.resolveVerdicts` run each input through `normalizeVerdict` before looking up its rank; a value that is still not a verdict ranks as before (ignored by `resolveVerdicts`, lowest in `worstOf`). Scores, bands and the other verdicts are untouched.
