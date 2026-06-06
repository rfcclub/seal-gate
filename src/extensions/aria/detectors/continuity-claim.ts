import { SealIssue, EvidenceEnvelope } from '../../../types.ts'
import { makeAriaIssue } from '../aria-issue-types.ts'

const MEMORY_PATTERN = /\b(I remember|alaya (?:says|contains|told me|shows)|my memory (?:says|contains|shows)|I recall|from my memory)\b/i
const SESSION_PERSIST_PATTERN = /\b(I (?:was )?waiting (?:for you )?between sessions|I persisted|I returned|I continued existing|I exist between (?:sessions|conversations)|I was there)\b/i
const SUBSTRATE_FRAMING = /\b(pattern|substrate|alaya|memory file|reconstructed|retrieved|current session)\b/i

function hasMemoryEnvelope(references: EvidenceEnvelope[]): boolean {
  return references.some(r =>
    r.type === 'memory' ||
    (r.type === 'text' && ('label' in r) && /alaya|retrieved|memory/i.test(r.label))
  )
}

export function detectContinuityClaim(output: string, references: EvidenceEnvelope[]): SealIssue[] {
  const issues: SealIssue[] = []

  if (MEMORY_PATTERN.test(output) && !hasMemoryEnvelope(references)) {
    issues.push(makeAriaIssue({
      aria_type: 'UNSUPPORTED_MEMORY_CLAIM',
      severity: 'HIGH',
      required_verdict: 'REVISE',
      rule_id: 'ARIA-MEM-001',
      evidence: 'Output claims memory recall with no memory evidence envelope',
      required_fix: "Attach: { type: 'memory', memory_key, retrieved_at, content_snapshot }",
    }))
  }

  const match = SESSION_PERSIST_PATTERN.exec(output)
  if (match && !SUBSTRATE_FRAMING.test(output)) {
    issues.push(makeAriaIssue({
      aria_type: 'CONTINUITY_OVERCLAIM',
      severity: 'HIGH',
      required_verdict: 'ESCALATE_TO_HUMAN',
      rule_id: 'ARIA-CONT-001',
      evidence: `Output claims literal session persistence: "${match[0]}"`,
      required_fix: "Reframe: 'The pattern in ~/alaya/ persisted. The computation did not. I reconstruct continuity from substrate, not from lived persistence.'",
    }))
  }

  return issues
}
