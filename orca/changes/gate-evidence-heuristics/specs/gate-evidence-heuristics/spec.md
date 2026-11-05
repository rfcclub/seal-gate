# gate-evidence-heuristics Specification

## ADDED Requirements

### Requirement: Heuristics read changed lines

#### Scenario: context-line-admin

- **WHEN** a unified diff changes one line and `admin` appears only in an unchanged context line
- **THEN** the review has no TW205 finding and the verdict is not ESCALATE_TO_HUMAN

#### Scenario: context-line-fix

- **WHEN** the reviewed output is a unified diff with `fix` only in an unchanged context line, and the test log has no regression keyword
- **THEN** the review has no TW203 finding

#### Scenario: auth-path

- **WHEN** a unified diff changes a file under an `auth` path and its changed lines contain no auth keyword
- **THEN** the review has a TW205 finding

#### Scenario: prose-after-hunk

- **WHEN** the reviewed output has a unified diff hunk followed by indented prose containing an auth keyword
- **THEN** the hunk ends at its header's line counts, the prose is classified, and the review has a TW205 finding

### Requirement: Regression evidence is structured

#### Scenario: malformed-records

- **WHEN** regression records lack a test path or assertion name, or carry a hash that is not a SHA-256
- **THEN** the review still has a TW203 finding

#### Scenario: structured-regression

- **WHEN** a bug-fix review carries `evidence.regression` where one assertion failed in RED and passed in GREEN with the same test file hash, and the test log has no keyword
- **THEN** the review has no TW203 finding

#### Scenario: keyword-only

- **WHEN** a bug-fix review has a test log containing `regression` and no `evidence.regression`
- **THEN** the review has a TW203 finding whose evidence names `evidence.regression`
