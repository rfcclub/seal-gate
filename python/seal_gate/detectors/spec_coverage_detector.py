import re
from ..types import SealIssue, make_issue

CRITERIA_RE = re.compile(r'^[-*]\s+.+', re.M)
HEADER_RE = re.compile(r'^#{1,3}\s+(.+)', re.M)


def detect_spec_coverage(spec: str | None, output: str) -> dict:
    if not spec or not spec.strip():
        return {'issues': [], 'assumptions': ['No spec provided — L1 (spec compliance) skipped'], 'trust_deductions': 0}

    issues: list[SealIssue] = []
    deductions = 0

    criteria_lines = [l.strip().lstrip('-* ') for l in CRITERIA_RE.findall(spec)]
    missing = []
    for criterion in criteria_lines:
        keywords = [w for w in criterion.split() if len(w) >= 4]
        if not any(kw.lower() in output.lower() for kw in keywords):
            missing.append(criterion)

    max_deduction = 20
    for criterion in missing:
        if deductions >= max_deduction:
            break
        issues.append(make_issue(type='SPEC_MISMATCH', severity='MEDIUM', layer='L1', source='core', rule_id='SC301', trust_deduction=10, evidence=f'Criterion not referenced: "{criterion}"', suggested_fix=f'Address: {criterion}'))
        deductions = min(deductions + 10, max_deduction)

    spec_headers = {h.lower() for h in HEADER_RE.findall(spec)}
    output_headers = [h.lower() for h in HEADER_RE.findall(output)]
    for header in output_headers:
        if spec_headers and header not in spec_headers:
            issues.append(make_issue(type='SPEC_MISMATCH', severity='LOW', layer='L1', source='core', rule_id='SC302', evidence=f'Output section "{header}" not in spec', suggested_fix='Verify scope'))

    return {'issues': issues, 'assumptions': [], 'trust_deductions': deductions}
