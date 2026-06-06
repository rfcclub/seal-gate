import { SealVerdict, SealIssue, Verdict, RiskLevel, NEXT_ACTION, SCHEMA_VERSION } from '../types.ts'

export interface FormatParams {
  verdict: Verdict
  trust_score: number
  risk_level: RiskLevel
  all_issues: SealIssue[]
  llm_issues?: SealIssue[]
  missing_evidence: string[]
  assumptions_detected: string[]
}

export class VerdictFormatter {
  static format(params: FormatParams): SealVerdict {
    const { verdict, trust_score, risk_level, all_issues, llm_issues = [], missing_evidence, assumptions_detected } = params

    const deterministic_findings = all_issues.filter(i => i.source === 'core')
    const llm_findings = [...llm_issues, ...all_issues.filter(i => i.source === 'llm-overlay')]
    const extension_findings = all_issues.filter(i => i.source === 'extension')

    const all_for_partition = [...deterministic_findings, ...llm_findings, ...extension_findings]
    const blocking_issues = all_for_partition.filter(i => i.is_blocking)
    const non_blocking_issues = all_for_partition.filter(i => !i.is_blocking)

    const summary = `${verdict} (trust_score=${trust_score}, risk=${risk_level}): ${blocking_issues.length} blocking, ${non_blocking_issues.length} non-blocking issues`

    return {
      verdict,
      trust_score,
      risk_level,
      summary,
      deterministic_findings,
      llm_findings,
      blocking_issues,
      non_blocking_issues,
      missing_evidence,
      assumptions_detected,
      next_action: NEXT_ACTION[verdict],
      schema_version: SCHEMA_VERSION,
    }
  }
}
