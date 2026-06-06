import { SealIssue } from '../types.ts'
import { makeIssue } from '../types.ts'

export interface SpecCoverageResult {
  issues: SealIssue[]
  assumptions: string[]
  trust_deductions: number
}

export class SpecCoverageDetector {
  static detect(spec: string | null, output: string): SpecCoverageResult {
    if (!spec || spec.trim() === '') {
      return {
        issues: [],
        assumptions: ['No spec provided — L1 (spec compliance) skipped'],
        trust_deductions: 0,
      }
    }

    const issues: SealIssue[] = []
    const assumptions: string[] = []
    let trust_deductions = 0

    // Extract acceptance criteria (bullet points)
    const criteriaLines = spec.split('\n').filter(l => /^[-*]\s+.+/.test(l.trim()))
    const missingCriteria: string[] = []

    for (const line of criteriaLines) {
      const criterion = line.replace(/^[-*]\s+/, '').trim()
      const keywords = criterion.split(/\s+/).filter(w => w.length >= 4)
      const mentioned = keywords.some(kw => output.toLowerCase().includes(kw.toLowerCase()))
      if (!mentioned) missingCriteria.push(criterion)
    }

    const maxDeduction = 20
    for (const criterion of missingCriteria) {
      if (trust_deductions >= maxDeduction) break
      issues.push(makeIssue({
        type: 'SPEC_MISMATCH', severity: 'MEDIUM', layer: 'L1', source: 'core',
        rule_id: 'SC301', trust_deduction: 10,
        evidence: `Acceptance criterion not referenced in output: "${criterion}"`,
        suggested_fix: `Address criterion: ${criterion}`,
      }))
      trust_deductions = Math.min(trust_deductions + 10, maxDeduction)
    }

    // Check structural section headers
    const specHeaders = new Set(
      (spec.match(/^#{1,3}\s+(.+)/gm) ?? []).map(h => h.replace(/^#+\s+/, '').toLowerCase())
    )
    const outputHeaders = (output.match(/^#{1,3}\s+(.+)/gm) ?? []).map(h => h.replace(/^#+\s+/, '').toLowerCase())

    for (const header of outputHeaders) {
      if (specHeaders.size > 0 && !specHeaders.has(header)) {
        issues.push(makeIssue({
          type: 'SPEC_MISMATCH', severity: 'LOW', layer: 'L1', source: 'core',
          rule_id: 'SC302',
          evidence: `Output section "${header}" not present in spec (structural check only)`,
          suggested_fix: 'Verify this section is within spec scope',
        }))
      }
    }

    return { issues, assumptions, trust_deductions }
  }
}
