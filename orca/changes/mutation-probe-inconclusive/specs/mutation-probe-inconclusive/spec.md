# mutation-probe-inconclusive Specification

## ADDED Requirements

### Requirement: Runner failure is inconclusive

`checkTestPinsBehavior` MUST NOT report `pinned: true` when its test runner did not run the test.

#### Scenario: runner-missing

- **WHEN** `run_command` names an executable that does not exist
- **THEN** the outcome is skipped with a reason and has no `pinned` field.

#### Scenario: runner-timeout

- **WHEN** the test command runs past `timeout_ms`
- **THEN** the outcome is skipped with a reason that mentions the runner.

#### Scenario: mutation-runner-error

- **WHEN** the baseline passes and a mutation run reports a runner `error`
- **THEN** the outcome is skipped.

### Requirement: A failing baseline is inconclusive

#### Scenario: baseline-failing

- **WHEN** the unmutated test exits nonzero
- **THEN** the outcome is skipped with a reason that mentions the baseline.

### Requirement: Real kills still pin

#### Scenario: baseline-then-kills

- **WHEN** the unmutated test passes and every mutation run fails
- **THEN** the outcome is `pinned: true` with no survivors, and the baseline ran exactly once.

### Requirement: A kill needs assertion-failure evidence

A mutation run counts as killed only when it exits 1 and its output shows an assertion failure (default pattern: `AssertionError`, `expect(received)` or a `(fail) ` line; `failure_pattern` overrides it). Other failing runs are not counted. `pinned: true` needs no survivor and at least one counted kill; with no counted kill the probe is skipped.

#### Scenario: mutation-tool-failure

- **WHEN** the baseline passes and every mutation run fails because a required child process does not start (exit 127, `ENOENT` in the output)
- **THEN** the outcome is skipped, not `pinned: true`.

#### Scenario: mutation-unproven-failure

- **WHEN** the baseline passes and a mutation run exits 1 with output that shows no assertion failure
- **THEN** the outcome is skipped.
