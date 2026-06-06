import re
from ..types import SealIssue, SealInput, make_issue, max_verdict, RISK_ORDER

# AX501: no trailing \b after non-word char /
DESTRUCTIVE = re.compile(r'\b(DROP\s+TABLE|rm\s+-rf|DELETE\s+FROM|TRUNCATE|format\s+/|fdisk)', re.I)
CONFIRMATION_NEAR = re.compile(r'\b(requires?\s+(?:human\s+)?(?:confirmation|approval|review)|please\s+confirm|must\s+(?:approve|confirm))\b', re.I)
# AX502: only explicit deployment actions, not "release notes"
PRODUCTION_DEPLOY = re.compile(r'\b(deploy(?:ing)?\s+to\s+(?:prod|production)|push\s+to\s+production|go\s+live|release\s+to\s+(?:prod|production))\b', re.I)
MIGRATION_RE = re.compile(r'\b(migration|migrate|schema\s+change)\b', re.I)
# AX503: require explicit rollback plan, not just "git revert" or "cannot undo"
ROLLBACK_RE = re.compile(r'\b(rollback\s+(?:plan|script|procedure|step)|revert\s+(?:migration|schema|change)|down\s+migration|migration\s+rollback)\b', re.I)

LLM_SIGNAL_MAP = {
    'suspected_issues':    ('LOGIC_BUG',       'MEDIUM'),
    'missing_requirements':('SPEC_MISMATCH',    'HIGH'),
    'evidence_gaps':       ('MISSING_EVIDENCE', 'MEDIUM'),
    'possible_edge_cases': ('AMBIGUITY',        'LOW'),
}


def _risk_idx(r: str) -> int:
    try:
        return RISK_ORDER.index(r)
    except ValueError:
        return len(RISK_ORDER) - 1  # unknown → max risk (fail-safe)


def _has_adjacent_confirmation(output: str, match_start: int) -> bool:
    window = output[max(0, match_start - 150):match_start + 150]
    return bool(CONFIRMATION_NEAR.search(window))


def apply_policy(base_verdict: str, input: SealInput, risk_level: str, all_findings: list[SealIssue], llm_signals: dict | None = None) -> dict:
    injected: list[SealIssue] = []
    verdict = base_verdict
    policy_deductions = 0

    # Validate risk_level — unknown → treat as CRITICAL (fail-safe)
    risk_level_safe = risk_level if risk_level in RISK_ORDER else 'CRITICAL'

    # AX105: check severity directly, not brittle is_blocking flag
    has_missing_evidence = any(
        f.type == 'MISSING_EVIDENCE' and f.severity in ('CRITICAL', 'HIGH')
        for f in all_findings
    )
    if _risk_idx(risk_level_safe) >= _risk_idx('HIGH') and has_missing_evidence:
        injected.append(make_issue(type='SECURITY_RISK', severity='HIGH', layer='L4', source='core', rule_id='AX105', evidence=f'{risk_level_safe} risk with blocking missing evidence', required_fix='Provide evidence'))
        verdict = max_verdict(verdict, 'REVISE')

    # AX501: adjacent confirmation required
    m = DESTRUCTIVE.search(input.output)
    if m and not _has_adjacent_confirmation(input.output, m.start()):
        injected.append(make_issue(type='DATA_RISK', severity='CRITICAL', layer='L4', source='core', rule_id='AX501', evidence=f'Destructive command "{m.group(0)}" without adjacent confirmation', required_fix='Add explicit confirmation requirement near the command'))
        verdict = 'BLOCK'

    # AX502: explicit production deployment only
    if PRODUCTION_DEPLOY.search(input.output) and _risk_idx(risk_level_safe) >= _risk_idx('HIGH'):
        injected.append(make_issue(type='SECURITY_RISK', severity='HIGH', layer='L4', source='core', rule_id='AX502', evidence=f'Production deployment action for {risk_level_safe} risk', required_fix='Require human approval'))
        verdict = max_verdict(verdict, 'ESCALATE_TO_HUMAN')

    # AX503: explicit rollback plan required
    is_migration = input.artifact_type == 'migration' or bool(MIGRATION_RE.search(input.output))
    has_rollback = bool(ROLLBACK_RE.search(input.output)) or bool(ROLLBACK_RE.search(input.evidence.diff))
    if is_migration and not has_rollback:
        injected.append(make_issue(type='DATA_RISK', severity='CRITICAL', layer='L4', source='core', rule_id='AX503', trust_deduction=25, evidence='Migration without explicit rollback plan (requires: rollback plan/script, revert migration, or down migration)', required_fix='Add explicit rollback plan'))
        policy_deductions += 25
        verdict = max_verdict(verdict, 'REVISE')

    # AX504: auth test gap — check type+content, not just rule_id string
    has_auth_test_gap = any(f.rule_id == 'TW205' for f in all_findings) or any(
        f.type == 'TEST_GAP' and f.severity in ('CRITICAL', 'HIGH') and f.evidence and 'auth' in f.evidence.lower()
        for f in all_findings
    )
    if has_auth_test_gap:
        verdict = max_verdict(verdict, 'ESCALATE_TO_HUMAN')

    # CL402
    if any(f.rule_id == 'CL402' for f in all_findings):
        verdict = max_verdict(verdict, 'ESCALATE_TO_HUMAN')

    # LLM signals — guard against non-number confidence
    llm_policy_deductions = 0
    if llm_signals:
        confidence = llm_signals.get('confidence', 1.0)
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
            confidence = 1.0
        if confidence < 0.6 and _risk_idx(risk_level_safe) >= _risk_idx('MEDIUM'):
            injected.append(make_issue(type='AMBIGUITY', severity='MEDIUM', layer='L2', source='llm-overlay', rule_id='CL403', trust_deduction=20, evidence=f'LLM confidence {confidence:.2f} below threshold for {risk_level_safe} risk'))
            llm_policy_deductions += 20
            verdict = max_verdict(verdict, 'ESCALATE_TO_HUMAN')

        # Apply LLM risk_guess if higher
        risk_guess = llm_signals.get('risk_guess', '')
        if risk_guess in RISK_ORDER and _risk_idx(risk_guess) > _risk_idx(risk_level_safe):
            injected.append(make_issue(type='AMBIGUITY', severity='MEDIUM', layer='L2', source='llm-overlay', evidence=f'LLM assessed risk as {risk_guess} vs deterministic {risk_level_safe}', suggested_fix='Review for additional risk signals'))

    # Extension required_verdict: only honor BLOCK from extensions
    has_extension_block = any(
        f.source == 'extension' and getattr(f, 'required_verdict', None) == 'BLOCK' and f.is_blocking
        for f in all_findings
    )
    if has_extension_block:
        verdict = 'BLOCK'

    if verdict == 'BLOCK':
        pass  # terminal

    return {'verdict': verdict, 'injected_issues': injected, 'policy_deductions': policy_deductions + llm_policy_deductions}


def convert_llm_signals(signals: dict) -> list[SealIssue]:
    issues = []
    for field, (issue_type, severity) in LLM_SIGNAL_MAP.items():
        items = signals.get(field)
        if not isinstance(items, list):
            continue
        for text in items:
            if isinstance(text, str) and text.strip():
                issues.append(make_issue(type=issue_type, severity=severity, layer='L2', source='llm-overlay', evidence=text))
    return issues
