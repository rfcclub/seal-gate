import { RiskLevel } from '../types.ts'

const RISK_ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b
}

const CRITICAL_PATTERN = /\b(DROP\s+TABLE|delete.{0,20}production|rm\s+-rf|irreversible|PII|personal\s+data|health\s+data|financial\s+record|legal\s+(?:liability|compliance)|payment|billing)\b/i
const HIGH_PATTERN = /\b(auth(?:entication|orization)?|token|session|JWT|OAuth|password|migration|rollback|schema\s+change|chmod|sudo|admin|privilege)\b/i

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
    } else if (HIGH_PATTERN.test(text)) {
      risk_level = maxRisk(risk_level, 'HIGH')
      trust_deduction += 10
      matched_rules.push('RK-HIGH')
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
