# help-exit-zero Specification

## ADDED Requirements

### Requirement: Help is not an error

#### Scenario: help-flags

- **WHEN** `seal --help`, `seal help` or `seal -h` runs
- **THEN** stdout contains `USAGE` and the exit code is 0, while `seal` alone and an unknown command exit 2.
