import re
from ..types import max_risk, RISK_ORDER

CRITICAL_PATTERN = re.compile(r'\b(DROP\s+TABLE|delete.{0,20}production|rm\s+-rf|irreversible|PII|personal\s+data|health\s+data|financial\s+record|legal\s+(?:liability|compliance)|payment|billing)\b', re.I)
# HIGH: auth/security constructs that require elevated access or auth test evidence
# MEDIUM-risk operational terms moved to MEDIUM_PATTERN
HIGH_PATTERN = re.compile(r'\b(auth(?:entication|orization)?|JWT|OAuth|sudo|admin|privilege|chmod)\b', re.I)
MEDIUM_PATTERN = re.compile(r'\b(migration|rollback|schema\s+change|token|session|password)\b', re.I)


def classify_risk(output: str, diff: str, risk_hint: str | None) -> dict:
    text = output + '\n' + diff
    risk_level = 'MEDIUM'
    trust_deduction = 0
    matched_rules: list[str] = []

    if CRITICAL_PATTERN.search(text):
        risk_level = max_risk(risk_level, 'CRITICAL')
        trust_deduction += 20
        matched_rules.append('RK-CRITICAL')
    if HIGH_PATTERN.search(text):
        risk_level = max_risk(risk_level, 'HIGH')
        if 'RK-HIGH' not in matched_rules:
            trust_deduction += 10
            matched_rules.append('RK-HIGH')
    if 'RK-HIGH' not in matched_rules and 'RK-CRITICAL' not in matched_rules and MEDIUM_PATTERN.search(text):
        if 'RK-MEDIUM' not in matched_rules:
            trust_deduction += 5
            matched_rules.append('RK-MEDIUM')

    if risk_hint:
        prev = risk_level
        risk_level = max_risk(risk_level, risk_hint)
        if risk_level != prev:
            trust_deduction += 10 if risk_level == 'CRITICAL' else 5

    return {'risk_level': risk_level, 'trust_deduction': trust_deduction, 'matched_rules': matched_rules}
