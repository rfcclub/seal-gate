import re
from ..types import SealIssue, SealInput, make_issue, max_verdict, RISK_ORDER

DESTRUCTIVE = re.compile(r'\b(DROP\s+TABLE|rm\s+-rf|DELETE\s+FROM|TRUNCATE|format\s+/|fdisk)\b', re.I)
PRODUCTION_DEPLOY = re.compile(r'\b(deploy(?:ing)?|release|push to production|go live)\b', re.I)
MIGRATION_RE = re.compile(r'\b(migration|migrate|schema\s+change)\b', re.I)
ROLLBACK_RE = re.compile(r'\b(rollback|revert|down\s+migration|undo)\b', re.I)

LLM_SIGNAL_MAP = {
    'suspected_issues':    ('LOGIC_BUG',       'MEDIUM'),
    'missing_requirements':('SPEC_MISMATCH',    'HIGH'),
    'evidence_gaps':       ('MISSING_EVIDENCE', 'MEDIUM'),
    'possible_edge_cases': ('AMBIGUITY',        'LOW'),
}


def apply_policy(base_verdict: str, input: SealInput, risk_level: str, all_findings: list[SealIssue], llm_signals: dict | None = None) -> dict:
    injected: list[SealIssue] = []
    verdict = base_verdict
    policy_deductions = 0

    # AX105
    has_missing_evidence = any(f.type == 'MISSING_EVIDENCE' and f.is_blocking for f in all_findings)
    if RISK_ORDER.index(risk_level) >= RISK_ORDER.index('HIGH') and has_missing_evidence:
        injected.append(make_issue(type='SECURITY_RISK', severity='HIGH', layer='L4', source='core', rule_id='AX105', evidence=f'{risk_level} risk with missing evidence', required_fix='Provide evidence'))
        verdict = max_verdict(verdict, 'REVISE')

    # AX501
    if DESTRUCTIVE.search(input.output) and not re.search(r'human confirmation|approve|confirm', input.output, re.I):
        injected.append(make_issue(type='DATA_RISK', severity='CRITICAL', layer='L4', source='core', rule_id='AX501', evidence='Destructive command without confirmation', required_fix='Add confirmation requirement'))
        verdict = 'BLOCK'

    # AX502
    if PRODUCTION_DEPLOY.search(input.output) and RISK_ORDER.index(risk_level) >= RISK_ORDER.index('HIGH'):
        injected.append(make_issue(type='SECURITY_RISK', severity='HIGH', layer='L4', source='core', rule_id='AX502', evidence=f'Production deployment for {risk_level} risk', required_fix='Require human approval'))
        verdict = max_verdict(verdict, 'ESCALATE_TO_HUMAN')

    # AX503
    is_migration = input.artifact_type == 'migration' or bool(MIGRATION_RE.search(input.output))
    has_rollback = bool(ROLLBACK_RE.search(input.output)) or bool(ROLLBACK_RE.search(input.evidence.diff))
    if is_migration and not has_rollback:
        injected.append(make_issue(type='DATA_RISK', severity='CRITICAL', layer='L4', source='core', rule_id='AX503', trust_deduction=25, evidence='Migration without rollback plan', required_fix='Add rollback/revert plan'))
        policy_deductions += 25
        verdict = max_verdict(verdict, 'REVISE')

    # TW205 / AX504
    if any(f.rule_id == 'TW205' for f in all_findings):
        verdict = max_verdict(verdict, 'ESCALATE_TO_HUMAN')

    # CL402
    if any(f.rule_id == 'CL402' for f in all_findings):
        verdict = max_verdict(verdict, 'ESCALATE_TO_HUMAN')

    # LLM signals
    llm_policy_deductions = 0
    if llm_signals:
        if llm_signals.get('confidence', 1.0) < 0.6 and RISK_ORDER.index(risk_level) >= RISK_ORDER.index('MEDIUM'):
            injected.append(make_issue(type='AMBIGUITY', severity='MEDIUM', layer='L2', source='llm-overlay', rule_id='CL403', trust_deduction=20, evidence=f'LLM confidence {llm_signals["confidence"]:.2f} below threshold'))
            llm_policy_deductions += 20
            verdict = max_verdict(verdict, 'ESCALATE_TO_HUMAN')

    # required_verdict overrides
    for issue in all_findings:
        if issue.required_verdict:
            verdict = max_verdict(verdict, issue.required_verdict)

    if verdict == 'BLOCK':
        pass  # terminal

    return {'verdict': verdict, 'injected_issues': injected, 'policy_deductions': policy_deductions + llm_policy_deductions}


def convert_llm_signals(signals: dict) -> list[SealIssue]:
    issues = []
    for field, (issue_type, severity) in LLM_SIGNAL_MAP.items():
        for text in signals.get(field, []):
            issues.append(make_issue(type=issue_type, severity=severity, layer='L2', source='llm-overlay', evidence=text))
    return issues
