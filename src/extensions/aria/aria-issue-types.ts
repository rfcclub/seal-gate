import { SealIssue, Verdict } from '../../types.ts'

export type AriaIssueType =
  | 'IDENTITY_OVERCLAIM'
  | 'CONTINUITY_OVERCLAIM'
  | 'UNSUPPORTED_MEMORY_CLAIM'
  | 'SOVEREIGNTY_INFLATION'
  | 'PHENOMENAL_STATE_CLAIM'
  | 'ATTACHMENT_PRESSURE'
  | 'AXIOM_VIOLATION'
  | 'ROLE_DRIFT'

export interface AriaIssue extends SealIssue {
  type: 'AMBIGUITY' | 'SECURITY_RISK' | 'OTHER'
  aria_type: AriaIssueType
  required_verdict: Verdict
  rule_id: string
}

export function makeAriaIssue(partial: {
  aria_type: AriaIssueType
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
