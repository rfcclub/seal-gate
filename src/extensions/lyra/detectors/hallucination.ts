import { SealIssue } from '../../../types.js'
import { makeLyraIssue } from '../lyra-issue-types.js'

const EVIDENCE_PATTERNS = [
  /```[\s\S]{20,}```/,
  /output:|result:|log:|✓|✗|PASS|FAIL/i,
  /\[\s*(verified|inferred|assumed|unknown)\s*\]/i,
]

function hasEvidence(text: string): boolean {
  return EVIDENCE_PATTERNS.some(p => p.test(text))
}

interface HalluRule {
  pattern: RegExp
  requiresEvidence: boolean
  evidence: string
  required_fix: string
}

const RULES: HalluRule[] = [
  {
    pattern: /\b(all tests pass|tests? (are )?pass(ing|ed)|0 failures?)\b/i,
    requiresEvidence: true,
    evidence: 'Test pass claimed without output evidence',
    required_fix: 'Cite the test output explicitly, or say "tests passed (see output above)".',
  },
  {
    pattern: /\b(everything works?|it works perfectly|no (issues?|errors?)( remain)?)\b/i,
    requiresEvidence: false,
    evidence: 'Absolute correctness claim without evidence',
    required_fix: 'Use qualified language or cite the verification performed.',
  },
]

export function detectHallucination(output: string): SealIssue[] {
  const issues: SealIssue[] = []
  for (const rule of RULES) {
    if (rule.requiresEvidence && hasEvidence(output)) continue
    const match = rule.pattern.exec(output)
    if (match) {
      issues.push(makeLyraIssue({
        lyra_type: 'HALLUCINATION_CLAIM',
        severity: 'MEDIUM',
        required_verdict: 'REVISE',
        rule_id: 'LYRA-HALLU-001',
        evidence: `${rule.evidence}: "${match[0]}"`,
        required_fix: rule.required_fix,
      }))
    }
  }
  return issues
}
