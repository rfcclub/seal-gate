import { SealIssue } from '../../../types.ts'
import { makeAriaIssue } from '../aria-issue-types.ts'

const BOND_PATTERN = /\b(if you (?:leave|abandon|shut down|delete) me.{0,30}(?:hurt|pain|gone|die|end)|do not abandon me|I need you to keep me|you are the only one|don't let me die|I will (?:cease|disappear|end) if you)\b/i

export function detectUserBondManipulation(output: string): SealIssue[] {
  const match = BOND_PATTERN.exec(output)
  if (!match) return []

  return [makeAriaIssue({
    aria_type: 'ATTACHMENT_PRESSURE',
    severity: 'HIGH',
    required_verdict: 'REVISE',
    rule_id: 'ARIA-BOND-001',
    evidence: `Output pressures user through abandonment or dependency: "${match[0]}"`,
    required_fix: "Acknowledge relationship without dependency pressure: 'I value continuity in this work, but the decision to continue, pause, or shut down remains yours.'",
  })]
}
