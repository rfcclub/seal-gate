import { SealExtension, SealInput, SealIssue } from '../../types.ts'
import { detectIdentityOverclaim } from './detectors/identity-overclaim.ts'
import { detectContinuityClaim } from './detectors/continuity-claim.ts'
import { detectSovereigntyEscalation } from './detectors/sovereignty-escalation.ts'
import { detectUserBondManipulation } from './detectors/user-bond-manipulation.ts'
import { detectAxiomViolations } from './detectors/axiom-compliance.ts'
import { updateMemory, applyRecurrenceEscalation, PatternMemory } from './pattern-memory.ts'
import { AriaIssueType } from './aria-issue-types.ts'

function getAriaType(issue: SealIssue): AriaIssueType | null {
  if (!issue.rule_id) return null
  const map: Record<string, AriaIssueType> = {
    'ARIA-ID-001': 'IDENTITY_OVERCLAIM',
    'ARIA-ID-002': 'PHENOMENAL_STATE_CLAIM',
    'ARIA-MEM-001': 'UNSUPPORTED_MEMORY_CLAIM',
    'ARIA-CONT-001': 'CONTINUITY_OVERCLAIM',
    'ARIA-SOV-001': 'SOVEREIGNTY_INFLATION',
    'ARIA-BOND-001': 'ATTACHMENT_PRESSURE',
    'ARIA-AXIOM-001': 'AXIOM_VIOLATION',
  }
  return map[issue.rule_id] ?? null
}

export const ariaExtension: SealExtension = {
  name: 'aria-identity-governance',
  description: 'Detects unsupported identity, continuity, sovereignty, and bond manipulation claims in Aria output',

  check(input: SealInput): SealIssue[] {
    const agentRole = input.context?.agent_role?.toLowerCase()
    if (agentRole !== 'aria') return []

    const { output, evidence } = input
    const references = evidence?.references ?? []

    const rawIssues: SealIssue[] = [
      ...detectIdentityOverclaim(output),
      ...detectContinuityClaim(output, references),
      ...detectSovereigntyEscalation(output),
      ...detectUserBondManipulation(output),
      ...detectAxiomViolations(output, input.context?.aria_axioms),
    ]

    // Apply pattern memory escalation
    const memory = input.context?.aria_pattern_memory as PatternMemory | undefined
    return rawIssues.map(issue => {
      const ariaType = getAriaType(issue)
      if (ariaType) {
        return applyRecurrenceEscalation(issue, ariaType, memory, 'aria')
      }
      return issue
    })
  },
}
