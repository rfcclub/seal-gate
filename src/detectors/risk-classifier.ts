import { RiskLevel } from '../types.js'

const RISK_ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b
}

const CRITICAL_PATTERN = /\b(DROP\s+TABLE|delete.{0,20}production|rm\s+-rf|irreversible|PII|personal\s+data|health\s+data|financial\s+record|legal\s+(?:liability|compliance)|payment|billing)\b/i
// HIGH: auth/security constructs that require elevated access or auth test evidence
// MEDIUM-risk operational terms (migration, rollback, session, token, password) moved to MEDIUM_PATTERN
const HIGH_PATTERN = /\b(auth(?:entication|orization)?|JWT|OAuth|sudo|admin|privilege|chmod)\b/i
const MEDIUM_PATTERN = /\b(migration|rollback|schema\s+change|token|session|password)\b/i

export interface RiskResult {
  risk_level: RiskLevel
  trust_deduction: number
  matched_rules: string[]
}

export class RiskClassifier {
  static classify(params: { output: string; diff: string; risk_hint: RiskLevel | null }): RiskResult {
    const { output, diff, risk_hint } = params
    const text = output + '\n' + diff
    let risk_level: RiskLevel = 'MEDIUM'
    let trust_deduction = 0
    const matched_rules: string[] = []

    if (CRITICAL_PATTERN.test(text)) {
      risk_level = maxRisk(risk_level, 'CRITICAL')
      trust_deduction += 20
      matched_rules.push('RK-CRITICAL')
    }
    if (HIGH_PATTERN.test(text)) {
      risk_level = maxRisk(risk_level, 'HIGH')
      if (!matched_rules.includes('RK-HIGH')) {
        trust_deduction += 10
        matched_rules.push('RK-HIGH')
      }
    }
    if (!matched_rules.includes('RK-HIGH') && !matched_rules.includes('RK-CRITICAL') && MEDIUM_PATTERN.test(text)) {
      if (!matched_rules.includes('RK-MEDIUM')) {
        trust_deduction += 5
        matched_rules.push('RK-MEDIUM')
      }
    }

    if (risk_hint) {
      const prevLevel = risk_level
      risk_level = maxRisk(risk_level, risk_hint)
      if (risk_level !== prevLevel) {
        if (risk_level === 'CRITICAL') trust_deduction += 10
        else if (risk_level === 'HIGH') trust_deduction += 5
      }
    }

    return { risk_level, trust_deduction, matched_rules }
  }
}
