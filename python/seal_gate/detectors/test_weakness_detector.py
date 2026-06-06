import re
from ..types import SealIssue, SealEvidence, make_issue, RISK_ORDER

NEGATIVE_TEST = re.compile(r'\b(fail|error|exception|invalid|unauthorized|forbidden|edge|negative|reject|timeout|backoff)\b', re.I)
RETRY = re.compile(r'\b(retry|retries|exponential.?backoff|timeout|circuit.?breaker)\b', re.I)
BUG_FIX = re.compile(r'\b(fix(?:ed)?|bug|defect|regression)\b', re.I)
REGRESSION_TEST = re.compile(r'\b(regression|repro|original.?bug|fixed.?case)\b', re.I)
AUTH_UNAUTH = re.compile(r'\b(unauthorized|forbidden|403|401|permission.?denied|access.?denied)\b', re.I)


def detect_test_weakness(artifact_type: str, output: str, risk_level: str, auth_flagged: bool, evidence: SealEvidence) -> dict:
    issues: list[SealIssue] = []
    deductions = 0
    test_log = evidence.test_log

    if artifact_type in ('code_diff', 'llm_response') and not test_log.strip():
        issues.append(make_issue(type='TEST_GAP', severity='HIGH', layer='L4', source='core', rule_id='TW201', trust_deduction=15, evidence='Implementation artifact has no test evidence', required_fix='Provide test_log'))
        deductions += 15

    is_medium_plus = RISK_ORDER.index(risk_level) >= RISK_ORDER.index('MEDIUM')
    if is_medium_plus and test_log.strip() and not NEGATIVE_TEST.search(test_log):
        issues.append(make_issue(type='TEST_GAP', severity='MEDIUM', layer='L4', source='core', rule_id='TW202', trust_deduction=10, evidence=f'Tests appear happy path only for {risk_level} risk', suggested_fix='Add negative cases'))
        deductions += 10

    if BUG_FIX.search(output) and test_log.strip() and not REGRESSION_TEST.search(test_log):
        issues.append(make_issue(type='TEST_GAP', severity='HIGH', layer='L4', source='core', rule_id='TW203', evidence='Bug fix without regression test', required_fix='Add regression test'))

    if RETRY.search(output) and test_log.strip() and not NEGATIVE_TEST.search(test_log):
        issues.append(make_issue(type='TEST_GAP', severity='MEDIUM', layer='L4', source='core', rule_id='TW204', evidence='Retry logic without failure/timeout test', suggested_fix='Add timeout/failure tests'))

    if auth_flagged and test_log.strip() and not AUTH_UNAUTH.search(test_log):
        issues.append(make_issue(type='TEST_GAP', severity='CRITICAL', layer='L4', source='core', rule_id='TW205', required_verdict='ESCALATE_TO_HUMAN', evidence='Auth change without unauthorized test', required_fix='Add unauthorized/forbidden test'))

    return {'issues': issues, 'trust_deductions': deductions}
