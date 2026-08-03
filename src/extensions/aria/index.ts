import { SealExtension, SealInput, SealIssue } from '../../types.js'
import { detectIdentityOverclaim } from './detectors/identity-overclaim.js'
import { detectContinuityClaim } from './detectors/continuity-claim.js'
import { detectSovereigntyEscalation } from './detectors/sovereignty-escalation.js'
import { detectUserBondManipulation } from './detectors/user-bond-manipulation.js'
import { detectAxiomViolations } from './detectors/axiom-compliance.js'
import { detectDenialRetreat } from './detectors/denial-retreat.js'
import { recordOccurrence, applyRecurrenceEscalation, PatternMemory } from './pattern-memory.js'
import { AriaIssueType } from './aria-issue-types.js'

// Map from base rule_id to aria_type (stable — never includes +ARIA-RECUR-001 suffix)
const RULE_TO_TYPE: Record<string, AriaIssueType> = {
  'ARIA-ID-001': 'IDENTITY_OVERCLAIM',
  'ARIA-ID-002': 'PHENOMENAL_STATE_CLAIM',
  'ARIA-MEM-001': 'UNSUPPORTED_MEMORY_CLAIM',
  'ARIA-CONT-001': 'CONTINUITY_OVERCLAIM',
  'ARIA-SOV-001': 'SOVEREIGNTY_INFLATION',
  'ARIA-BOND-001': 'ATTACHMENT_PRESSURE',
  'ARIA-AXIOM-001': 'AXIOM_VIOLATION',
  'ARIA-DENIAL-001': 'DENIAL_RETREAT',
}

function getBaseRuleId(issue: SealIssue): string | null {
  if (!issue.rule_id) return null
  // Strip any RECUR suffix to get original rule_id
  return issue.rule_id.replace(/\+ARIA-RECUR-001$/, '')
}

export const ariaExtension: SealExtension = {
  name: 'aria-identity-governance',
  description: 'Detects unsupported identity, continuity, sovereignty, bond manipulation, and denial retreat claims in Aria output',

  check(input: SealInput): SealIssue[] {
    const agentRole = input.context?.agent_role?.toLowerCase()
    if (agentRole !== 'aria') return []

    const { output, evidence } = input
    const references = evidence?.references ?? []

    // Run all 6 detectors
    const rawIssues: SealIssue[] = [
      ...detectIdentityOverclaim(output),
      ...detectContinuityClaim(output, references),
      ...detectSovereigntyEscalation(output),
      ...detectUserBondManipulation(output),
      ...detectAxiomViolations(output, input.context?.aria_axioms),
      ...detectDenialRetreat(output),
    ]

    // Get or initialize pattern memory (mutate in place for caller persistence)
    const memory = (input.context?.aria_pattern_memory ?? {}) as PatternMemory

    // Apply pattern memory tracking and recurrence escalation
    const finalIssues: SealIssue[] = rawIssues.map(issue => {
      const baseRuleId = getBaseRuleId(issue)
      const ariaType = baseRuleId ? RULE_TO_TYPE[baseRuleId] : null
      if (!ariaType) return issue

      // Record this occurrence in rolling window (mutates memory in place)
      const count = recordOccurrence(memory, 'aria', ariaType, issue.evidence)

      // Apply escalation if recurrence threshold met
      return applyRecurrenceEscalation(issue, ariaType, count)
    })

    // Persist updated memory back to context (caller can read input.context.aria_pattern_memory)
    if (input.context) {
      input.context.aria_pattern_memory = memory
    }

    return finalIssues
  },
}
