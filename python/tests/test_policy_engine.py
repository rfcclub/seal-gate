import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from seal_gate.engine.policy_engine import apply_policy
from seal_gate.types import SealInput, SealEvidence, make_issue

BASE_INPUT = SealInput(
    artifact_type='code_diff',
    spec=None,
    output='Implemented the feature.',
    evidence=SealEvidence(),
    risk_hint=None,
)


# Mirrors tests/engine/policy-engine-fabricated-evidence.test.ts (TS).
# Discovering a detector's citation was fabricated must actually change the verdict,
# not just appear in a side-channel report field.
def test_fabricated_evidence_escalates_to_human():
    fabricated = make_issue(
        type='FABRICATED_EVIDENCE',
        severity='CRITICAL',
        layer='L3',
        source='core',
        evidence='Detector claimed citation at app.ts:99 but it was location_not_found',
    )

    result = apply_policy(
        base_verdict='PASS',
        input=BASE_INPUT,
        risk_level='LOW',
        all_findings=[fabricated],
    )

    assert result['verdict'] == 'ESCALATE_TO_HUMAN'


def test_no_fabricated_evidence_does_not_escalate():
    result = apply_policy(
        base_verdict='PASS',
        input=BASE_INPUT,
        risk_level='LOW',
        all_findings=[],
    )

    assert result['verdict'] == 'PASS'


# Parity with src/engine/policy-engine.ts:68 — AX501/502/503 are code-mode-specific
# and must NOT fire for plan_review artifacts (they describe destructive commands,
# they don't execute them). Prevent false-positive divergence between TS and Python.
def test_plan_review_skips_destructive_rules():
    plan_input = SealInput(
        artifact_type='plan_review',
        spec=None,
        output='The migration will DROP TABLE users and then execute rm -rf /tmp before deploying.',
        evidence=SealEvidence(diff='ALTER TABLE users ADD COLUMN x'),
        risk_hint=None,
    )

    result = apply_policy(
        base_verdict='PASS',
        input=plan_input,
        risk_level='HIGH',
        all_findings=[],
    )

    # Destructive command present but plan_review: no AX501/502/503 injected, verdict stays PASS
    assert result['verdict'] == 'PASS'
    ax = [i for i in result.get('injected_issues', []) if i.rule_id in ('AX501', 'AX502', 'AX503')]
    assert ax == []


def test_code_diff_still_enforces_destructive_rules():
    code_input = SealInput(
        artifact_type='code_diff',
        spec=None,
        output='Remove the DB schema by running DROP TABLE users.',
        evidence=SealEvidence(),
        risk_hint=None,
    )

    result = apply_policy(
        base_verdict='PASS',
        input=code_input,
        risk_level='HIGH',
        all_findings=[],
    )

    # Same destructive command in a code diff MUST trigger AX501
    assert any(i.rule_id == 'AX501' for i in result.get('injected_issues', []))
