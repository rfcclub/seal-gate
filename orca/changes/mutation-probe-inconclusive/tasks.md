# Tasks

- [x] M1 (SC-1, SC-2, SC-3): Add failing tests in tests/spec/mutation-probe.test.ts for runner-missing, runner-timeout, mutation-runner-error, baseline-failing and baseline-then-kills; include tests/spec in vitest.config.mjs.
- [x] M2 (SC-1, SC-2, SC-3): In src/spec/mutation-probe.ts, classify runner errors, add timeout_ms, run the baseline first and return skipped for runner errors and a failing baseline.
- [x] M3 (SC-4): Add tests/spec/ and src/drift/__tests__/ to the package.json test script; full Bun suite, build, verify and gates; self-check.

- [x] M4 (SC-5): Add failing tests for mutation-tool-failure (real default runner, child ENOENT, exit 127) and mutation-unproven-failure, plus a real-bun pin test. Require exit 1 and failure_pattern for a kill, and give the fakes assertion output.

## Locked criteria mapping
- SC-1: M1/M2 runner-missing, runner-timeout.
- SC-2: M1/M2 baseline-failing.
- SC-3: M1/M2 mutation-runner-error, baseline-then-kills.
- SC-4: M3 the test script and its full run.
- SC-5: M4 mutation-tool-failure, mutation-unproven-failure and an unmapped real-bun pin regression test.
