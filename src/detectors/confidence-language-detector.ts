import { SealIssue, RiskLevel, SealEvidence } from '../types.ts'
import { makeIssue } from '../types.ts'

const OVERCONFIDENT_PATTERN = /\b(definitely|guaranteed|fully|completely|all\s+good|no\s+issues|production.?ready)\b/gi
const HEDGING_PATTERN = /\b(probably|should\s+work|seems|might|appears\s+to|I\s+think)\b/gi

export interface ConfidenceLangResult {
  issues: SealIssue[]
  trust_deductions: number
  advisory_notes: string[]
}

export class ConfidenceLanguageDetector {
  static detect(params: {
    output: string
    risk_level: RiskLevel
    evidence: SealEvidence
    deduped_spans: Set<string>
  }): ConfidenceLangResult {
    const { output, risk_level, evidence, deduped_spans } = params
    const issues: SealIssue[] = []
    const advisory_notes: string[] = []
    let trust_deductions = 0

    const noEvidence = evidence.references.length === 0 && evidence.test_log.trim() === ''
    const riskOrder = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    const isHighPlus = riskOrder.indexOf(risk_level) >= riskOrder.indexOf('HIGH')

    // CL401: overconfident language without evidence — advisory only, does not affect score.
    // No dedup check: advisory notes don't create duplicate issues, and ClaimExtractor already claims these spans.
    if (noEvidence) {
      OVERCONFIDENT_PATTERN.lastIndex = 0
      const match = OVERCONFIDENT_PATTERN.exec(output)
      if (match) {
        advisory_notes.push(`CL401: overconfident language "${match[0]}" without supporting evidence — consider qualifying or adding evidence`)
      }
    }

    // CL402: hedging language on HIGH+ risk
    if (isHighPlus) {
      HEDGING_PATTERN.lastIndex = 0
      let match: RegExpExecArray | null
      if ((match = HEDGING_PATTERN.exec(output)) !== null) {
        issues.push(makeIssue({
          type: 'AMBIGUITY', severity: 'HIGH', layer: 'L4', source: 'core',
          rule_id: 'CL402', required_verdict: 'ESCALATE_TO_HUMAN',
          evidence: `Hedging language "${match[0]}" in HIGH/CRITICAL risk artifact`,
          required_fix: 'Either assert with evidence or escalate to human review',
        }))
      }
    }

    return { issues, trust_deductions, advisory_notes }
  }
}
