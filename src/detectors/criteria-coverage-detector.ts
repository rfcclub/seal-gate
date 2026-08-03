import { SealIssue, makeIssue } from '../types.js'

export interface LockedCriterion {
  id: string
  text: string
  source_file?: string
  source_line?: number
}

export interface CriteriaCoverageInput {
  artifact: string
  artifact_file?: string
  locked_criteria: LockedCriterion[]
}

export interface CriteriaCoverageResult {
  issues: SealIssue[]
  confirmed_strong_fields: number   // covered ACs → +5 TrustScore each (capped externally)
  no_criteria_escalate: boolean     // true → no locked criteria found → ESCALATE_TO_HUMAN
}

function isCovered(criterion: LockedCriterion, artifact: string): boolean {
  const lower = artifact.toLowerCase()

  // Direct AC id mention
  if (lower.includes(criterion.id.toLowerCase())) return true

  // Keyword coverage: extract significant words (>4 chars) from criterion text
  const words = criterion.text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4)
    .filter(w => !['shall', 'must', 'should', 'when', 'then', 'given', 'that', 'this', 'with'].includes(w))

  if (words.length === 0) return false

  // Require at least half of significant words present in artifact
  const matched = words.filter(w => lower.includes(w)).length
  return matched / words.length >= 0.5
}

export class CriteriaCoverageDetector {
  static detect(input: CriteriaCoverageInput): CriteriaCoverageResult {
    const { artifact, artifact_file = 'artifact', locked_criteria } = input

    // Preflight: no locked criteria → ESCALATE
    if (!locked_criteria || locked_criteria.length === 0) {
      return {
        issues: [{
          ...makeIssue({
            type: 'AMBIGUITY',
            severity: 'MEDIUM',   // non-blocking — escalation comes from required_verdict, not severity
            layer: 'L1',
            source: 'core',
            rule_id: 'PR002',
            required_verdict: 'ESCALATE_TO_HUMAN',
            trust_deduction: 15,
            evidence: 'No locked acceptance criteria — cannot measure coverage against fixed yardstick',
            suggested_fix: 'Lock criteria in intent.md or self-check.md BEFORE generating the artifact',
          }),
          policy_tags: ['coverage'],
          confidence: 1.0,
        }],
        confirmed_strong_fields: 0,
        no_criteria_escalate: true,
      }
    }

    const issues: SealIssue[] = []
    let confirmed = 0

    for (const criterion of locked_criteria) {
      if (isCovered(criterion, artifact)) {
        confirmed++
        continue
      }

      // Uncovered → SPEC_MISMATCH, Type H
      const sourceFile = criterion.source_file ?? 'intent.md'
      const sourceLine = criterion.source_line ?? 1
      const quote = `${criterion.id} ${criterion.text.length > 120 ? criterion.text.slice(0, 120) + '…' : criterion.text} — no artifact section addresses this`

      issues.push({
        ...makeIssue({
          type: 'SPEC_MISMATCH',
          severity: 'MEDIUM',
          layer: 'L1',
          source: 'core',
          rule_id: 'PR002',
          required_verdict: 'REVISE',
          trust_deduction: 10,
          evidence: `Uncovered criterion: ${criterion.id} — ${criterion.text.slice(0, 80)}`,
          suggested_fix: `Add a section in ${artifact_file} addressing: ${criterion.text.slice(0, 80)}`,
        }),
        evidence_file: sourceFile,
        evidence_lines: [sourceLine],
        evidence_quote: quote,
        criterion_ref: criterion.id,
        confidence: 0.8,
        policy_tags: ['coverage'],
      })
    }

    return { issues, confirmed_strong_fields: confirmed, no_criteria_escalate: false }
  }
}
