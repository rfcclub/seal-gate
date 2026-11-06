# Spec: reviewer verdict input boundaries

### Requirement: The old verdict name keeps its severity

Verdict aggregation MUST read `ESCALATE_TO_HUMAN` as `ESCALATE_TO_REVIEWER` before ranking, and only own alias keys MUST count as aliases.

#### Scenario: aggregation-ranks-the-old-name-as-the-reviewer-verdict

- **WHEN** verdicts containing the old name are aggregated with `resolveVerdicts`, `worstOf` and `maxVerdict`
- **THEN** the result is `ESCALATE_TO_REVIEWER` unless a worse verdict is present

#### Scenario: prototype-property-names-are-not-verdicts

- **WHEN** `constructor`, `toString`, `hasOwnProperty`, `__proto__` and `valueOf` are normalized and restored through trust memory
- **THEN** the normalizer gives null and trust memory keeps none of them
