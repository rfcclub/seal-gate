import re
from ..types import SealIssue, SealEvidence, make_issue, RISK_ORDER


def detect_evidence_gaps(claims: list, evidence: SealEvidence, risk_level: str = 'MEDIUM') -> dict:
    issues: list[SealIssue] = []
    missing: list[str] = []
    deductions = 0

    for claim in claims:
        if claim.type == 'test_result_claim':
            has_log = bool(evidence.test_log.strip())
            has_ref = any(r.get('type') == 'command' and re.search(r'test|spec|jest|vitest|pytest', r.get('command', ''), re.I) for r in evidence.references)
            if not has_log and not has_ref:
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='HIGH', layer='L3', source='core', rule_id='E001', trust_deduction=20, evidence=f'No test log for claim: "{claim.text}"', required_fix='Provide test_log or command evidence envelope with test output'))
                missing.append(f'test_log required for: {claim.text}')
                deductions += 20

        elif claim.type == 'build_claim':
            has_log = bool(evidence.build_log.strip())
            has_ref = any(r.get('type') == 'command' and re.search(r'build|compile|make|gradle|maven|tsc', r.get('command', ''), re.I) for r in evidence.references)
            if not has_log and not has_ref:
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='MEDIUM', layer='L3', source='core', rule_id='E002', trust_deduction=15, evidence=f'No build log for claim: "{claim.text}"', suggested_fix='Provide build_log or command evidence'))
                deductions += 15

        elif claim.type == 'risk_claim':
            has_sec = bool(evidence.test_log.strip()) and bool(re.search(r'security|auth|unauthorized|pentest|vuln', evidence.test_log, re.I))
            has_ref = any(r.get('type') == 'text' and re.search(r'security', r.get('label', ''), re.I) for r in evidence.references)
            if not has_sec and not has_ref:
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='HIGH', layer='L3', source='core', rule_id='E003', trust_deduction=20, evidence=f'No security reasoning for claim: "{claim.text}"', required_fix='Provide security test log or text envelope'))
                deductions += 20

        elif claim.type == 'production_claim' and RISK_ORDER.index(risk_level) >= RISK_ORDER.index('MEDIUM'):
            has_any = bool(evidence.references) or bool(evidence.test_log.strip())
            if not has_any:
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='CRITICAL', layer='L3', source='core', rule_id='E004', trust_deduction=20, evidence=f'No evidence for production claim: "{claim.text}"', required_fix='Provide evidence envelopes'))
                missing.append(f'production evidence required for: {claim.text}')
                deductions += 20

    return {'issues': issues, 'missing_evidence': missing, 'trust_deductions': deductions}
