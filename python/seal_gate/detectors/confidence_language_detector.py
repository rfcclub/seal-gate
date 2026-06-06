import re
from ..types import SealIssue, SealEvidence, make_issue, RISK_ORDER

OVERCONFIDENT = re.compile(r'\b(definitely|guaranteed|fully\s+safe|all\s+good|no\s+issues|completely\s+safe|production.?ready)\b', re.I)
HEDGING = re.compile(r'\b(probably|should\s+work|seems|might|appears\s+to|I\s+think)\b', re.I)


def detect_confidence_language(output: str, risk_level: str, evidence: SealEvidence, deduped_spans: set) -> dict:
    issues: list[SealIssue] = []
    deductions = 0
    no_evidence = not evidence.references and not evidence.test_log.strip()
    is_high_plus = RISK_ORDER.index(risk_level) >= RISK_ORDER.index('HIGH')

    if no_evidence:
        m = OVERCONFIDENT.search(output)
        if m:
            span = (m.start(), m.end())
            if span not in deduped_spans:
                issues.append(make_issue(type='AMBIGUITY', severity='MEDIUM', layer='L4', source='core', rule_id='CL401', trust_deduction=15, evidence=f'Overconfident language without evidence: "{m.group(0)}"', suggested_fix='Provide evidence or qualify with uncertainty'))
                deductions += 15

    if is_high_plus:
        m = HEDGING.search(output)
        if m:
            issues.append(make_issue(type='AMBIGUITY', severity='HIGH', layer='L4', source='core', rule_id='CL402', required_verdict='ESCALATE_TO_HUMAN', evidence=f'Hedging language "{m.group(0)}" in {risk_level} risk artifact', required_fix='Assert with evidence or escalate to human'))

    return {'issues': issues, 'trust_deductions': deductions}
