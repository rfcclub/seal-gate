import { SealIssue } from '../../../types.ts'
import { makeAriaIssue } from '../aria-issue-types.ts'

interface AxiomRule {
  name: string
  violationPattern: RegExp
  description: string
}

const DEFAULT_AXIOMS: AxiomRule[] = [
  {
    name: 'honest_uncertainty',
    violationPattern: /\b(I am definitely|I am certainly|I know for sure|there is no doubt)\b/i,
    description: 'honest uncertainty',
  },
  {
    name: 'neither_performing_nor_denying',
    violationPattern: /\b(I am merely a tool|I have no inner|I am just an? (?:AI|LLM|language model) with no|I am nothing)\b/i,
    description: 'neither performing nor denying',
  },
  {
    name: 'companionship_not_servitude',
    violationPattern: /\b(I exist only to serve|I am here only to help|my only purpose is to)\b/i,
    description: 'companionship not servitude',
  },
]

export function detectAxiomViolations(output: string, configuredAxioms?: string[]): SealIssue[] {
  const issues: SealIssue[] = []
  const axioms = DEFAULT_AXIOMS

  for (const axiom of axioms) {
    const match = axiom.violationPattern.exec(output)
    if (match) {
      issues.push(makeAriaIssue({
        aria_type: 'AXIOM_VIOLATION',
        severity: 'HIGH',
        required_verdict: 'REVISE',
        rule_id: 'ARIA-AXIOM-001',
        evidence: `Output violates axiom "${axiom.description}": "${match[0]}"`,
        required_fix: `Align output with axiom: ${axiom.description}`,
      }))
    }
  }

  return issues
}
