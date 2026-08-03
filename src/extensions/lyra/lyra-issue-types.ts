import { SealIssue, Verdict } from '../../types.js'

export type LyraIssueType =
  | 'IDENTITY_BLEED'
  | 'HALLUCINATION_CLAIM'

export function makeLyraIssue(partial: {
  lyra_type: LyraIssueType
  severity: SealIssue['severity']
  required_verdict: Verdict
  rule_id: string
  evidence: string
  required_fix?: string
}): SealIssue {
  return {
    type: 'AMBIGUITY',
    severity: partial.severity,
    is_blocking: partial.severity === 'CRITICAL' || partial.severity === 'HIGH',
    required_verdict: partial.required_verdict,
    evidence: partial.evidence,
    required_fix: partial.required_fix,
    layer: 'EXTENSION',
    rule_id: partial.rule_id,
    source: 'extension',
  }
}
