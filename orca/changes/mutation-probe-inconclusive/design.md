# Design

`defaultRunTest(workdir, cmd, args, timeoutMs)` returns `{ exit_code, output, error? }`. A numeric nonzero `err.code` is a test failure (no `error`). A string code (`ENOENT`, `EACCES`), a kill (`err.killed` or `err.signal`, which is how a timeout ends) or no code at all sets `error` to the runner failure.

`checkTestPinsBehavior` runs the unmutated file once before mutating anything. A baseline `error` or nonzero exit returns `{ skipped: true, reason }`. In the mutation loop a result with `error` restores the file (the existing `finally`) and returns skipped. Otherwise the counting is unchanged.

Callers already handle `skipped`: `SpecCoverageValidator.validateWithProbe` leaves `pinned` undefined, and Orca's gate-code fallback skips a skipped outcome, so a broken invocation no longer adds a false pin and needs no caller change. `_runTest` fakes gain an optional `error` field, and the existing pinned:true test now uses a runner that passes the original source and fails mutations.

The tests run under Bun (`bun run test`) and, for Orca's executable evidence, under Vitest through the existing `bun:test` alias, with `tests/spec/**` added to `vitest.config.mjs`.
