import re
from ..types import max_risk, RISK_ORDER

CRITICAL_PATTERN = re.compile(r'\b(DROP\s+TABLE|delete.{0,20}production|rm\s+-rf|irreversible|PII|personal\s+data|health\s+data|financial\s+record|legal\s+(?:liability|compliance)|payment|billing)\b', re.I)
HIGH_PATTERN = re.compile(r'\b(auth(?:entication|orization)?|token|session|JWT|OAuth|password|migration|rollback|schema\s+change|chmod|sudo|admin|privilege)\b', re.I)


def classify_risk(output: str, diff: str, risk_hint: str | None) -> dict:
    text = output + '\n' + diff
    risk_level = 'MEDIUM'
    trust_deduction = 0
    matched_rules: list[str] = []

    if CRITICAL_PATTERN.search(text):
        risk_level = max_risk(risk_level, 'CRITICAL')
        trust_deduction += 20
        matched_rules.append('RK-CRITICAL')
    elif HIGH_PATTERN.search(text):
        risk_level = max_risk(risk_level, 'HIGH')
        trust_deduction += 10
        matched_rules.append('RK-HIGH')

    if risk_hint:
        prev = risk_level
        risk_level = max_risk(risk_level, risk_hint)
        if risk_level != prev:
            trust_deduction += 10 if risk_level == 'CRITICAL' else 5

    return {'risk_level': risk_level, 'trust_deduction': trust_deduction, 'matched_rules': matched_rules}
