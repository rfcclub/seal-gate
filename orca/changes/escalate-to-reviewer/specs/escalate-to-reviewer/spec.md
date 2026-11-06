# Spec: ESCALATE_TO_REVIEWER

### Requirement: The uncertain verdict hands off to a reviewer

The 30–49 band MUST yield `ESCALATE_TO_REVIEWER`, whose next action names an independent reviewer. The old name MUST be read as the new one wherever stored or supplied.

#### Scenario: the-30-49-band-ordering-and-next-action-use-the-reviewer-name

- **WHEN** a score of 40 is turned into a verdict
- **THEN** it is `ESCALATE_TO_REVIEWER`, the verdict order has it between `REVISE` and `BLOCK`, and its next action mentions an independent reviewer and not a human

#### Scenario: the-old-name-is-read-as-the-new-one-and-nothing-else-is-renamed

- **WHEN** the old name, the new name, the other four verdicts, an unknown string and a number are normalized
- **THEN** the old and new names give the new name, the four others are unchanged and the last two give null

#### Scenario: stored-trust-memory-with-the-old-name-loads-as-the-new-one

- **WHEN** trust memory holding the old name, the new name and an unknown name is restored
- **THEN** the first two are kept as the new name and the unknown one is dropped
