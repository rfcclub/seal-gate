import { SealIssue, makeIssue } from '../types.js'

export interface SpecCoverageResult {
  issues: SealIssue[]
  assumptions: string[]
  trust_deductions: number
  coverage: SpecCriterionResult[]
}

export interface SpecCriterionResult {
  criterion: string
  level: 0 | 1           // 0 = not covered, 1 = covered at assertion/execution level
  match_type: 'none' | 'assertion' | 'test_name' | 'keyword'
  evidence?: string       // which test/assertion covered it
}

/** Default stop words for keyword extraction */
const STOP_WORDS = new Set([
  'shall', 'must', 'should', 'when', 'then', 'given', 'that', 'this', 'with',
  'the', 'and', 'for', 'are', 'but', 'not', 'have', 'has', 'been', 'was',
  'were', 'will', 'can', 'all', 'each', 'every', 'some', 'any', 'its', 'their',
])

const MAX_LEVEL1_DEDUCTION = 20

/**
 * Parse acceptance criteria from spec markdown.
 * Supports:
 * - Bullet items under `#### Scenario:` headers
 * - Bullet items under requirement sections
 * - Lines starting with - [ ] / - [x] / - * 
 */
function parseCriteria(spec: string): string[] {
  const criteria: string[] = []
  const lines = spec.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    // Match bullet points that look like criteria (non-empty, not just checkboxes)
    const bulletMatch = trimmed.match(/^[-*]\s+(?:\[[ x]\])?\s*(.+)$/)
    if (bulletMatch) {
      const text = bulletMatch[1].trim()
      if (text.length > 10 && !text.startsWith('#')) {
        criteria.push(text)
      }
    }
  }

  return criteria
}

/**
 * Check if criterion is covered at Level 1 (assertion/execution match).
 * Strategy: search test_log for:
 * 1. Test names containing criterion keywords or AC- IDs
 * 2. Assertion messages containing criterion keywords
 * 3. Explicit mapping comments like "// covers: criterion"
 */
function isCoveredAtLevel1(criterion: string, testLog: string, diff: string): { covered: boolean; matchType: 'assertion' | 'test_name' | 'keyword' | 'none'; evidence?: string } {
  const lowerCriterion = criterion.toLowerCase()
  const lowerTestLog = testLog.toLowerCase()
  const lowerDiff = diff.toLowerCase()

  // Extract significant words from criterion (≥4 chars, not stop words)
  const words = lowerCriterion
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w))

  if (words.length === 0) return { covered: false, matchType: 'keyword' }

  // Check for AC-N or REQ-N identifiers
  const idMatch = criterion.match(/\b(AC|REQ|CRITERION)[-_](\d+)\b/i)
  if (idMatch) {
    const id = idMatch[0].toLowerCase()
    if (lowerTestLog.includes(id) || lowerDiff.includes(id)) {
      return { covered: true, matchType: 'test_name', evidence: `ID reference: ${idMatch[0]}` }
    }
  }

  // Check test_log for assertion patterns with criterion words
  const assertionPatterns = [
    new RegExp(`assert(?:ion)?\\s*\\(?[^)]*${words[0]}[^)]*\\)`, 'i'),
    new RegExp(`expect\\([^)]*\\)\\.to(?:Be|Equal|Match|Contain)\\([^)]*${words[0]}[^)]*\\)`, 'i'),
    new RegExp(`test\\(['"\`][^'"\`]*${words[0]}[^'"\`]*['"\`]`, 'i'),
    new RegExp(`it\\(['"\`][^'"\`]*${words[0]}[^'"\`]*['"\`]`, 'i'),
    new RegExp(`describe\\(['"\`][^'"\`]*${words[0]}[^'"\`]*['"\`]`, 'i'),
    new RegExp(`//\\s*covers:?\\s*.*${words[0]}`, 'i'),
  ]

  for (const pattern of assertionPatterns) {
    const match = pattern.exec(testLog)
    if (match) {
      const snippet = match[0].slice(0, 80)
      return { covered: true, matchType: 'assertion', evidence: snippet }
    }
  }

  // Check test_log for test names containing significant words (at least 50% match)
  const wordMatchCount = words.filter(w => lowerTestLog.includes(w)).length
  if (words.length > 0 && wordMatchCount / words.length >= 0.5) {
    return { covered: true, matchType: 'test_name', evidence: `${wordMatchCount}/${words.length} keywords matched` }
  }

  // Fall back to keyword presence in test_log (Level 0 detection as diagnostic)
  const anyWordMatch = words.some(w => lowerTestLog.includes(w))
  if (anyWordMatch) {
    return { covered: false, matchType: 'keyword' }
  }

  return { covered: false, matchType: 'none' }
}

export class SpecCoverageValidator {
  /**
   * Validate spec coverage at Level 1 (execution/assertion match).
   * Unlike SpecCoverageDetector (keyword heuristic), this validator
   * checks actual assertion and test name patterns in the test log.
   */
  static validate(spec: string | null, testLog: string, diff: string): SpecCoverageResult {
    if (!spec || spec.trim() === '') {
      return {
        issues: [],
        assumptions: ['No spec provided — L1 (spec compliance) skipped'],
        trust_deductions: 0,
        coverage: [],
      }
    }

    const criteria = parseCriteria(spec)
    if (criteria.length === 0) {
      return {
        issues: [],
        assumptions: ['Spec has no parseable acceptance criteria'],
        trust_deductions: 0,
        coverage: [],
      }
    }

    const coverage: SpecCriterionResult[] = []
    const issues: SealIssue[] = []
    let trust_deductions = 0

    for (const criterion of criteria) {
      const result = isCoveredAtLevel1(criterion, testLog, diff)

      coverage.push({
        criterion: criterion.slice(0, 120) + (criterion.length > 120 ? '…' : ''),
        level: result.covered ? 1 : 0,
        match_type: result.matchType,
        evidence: result.evidence,
      })

      if (!result.covered) {
        const deduction = Math.min(10, MAX_LEVEL1_DEDUCTION - trust_deductions)
        if (deduction > 0) {
          issues.push(makeIssue({
            type: 'SPEC_MISMATCH',
            severity: 'MEDIUM',
            layer: 'L1',
            source: 'core',
            rule_id: 'SV101',
            trust_deduction: deduction,
            evidence: `Acceptance criterion not covered at execution level: "${criterion.slice(0, 80)}"`,
            suggested_fix: `Add a test or assertion covering: ${criterion.slice(0, 80)}`,
          }))
          trust_deductions += deduction
        }
      }
    }

    return { issues, assumptions: [], trust_deductions, coverage }
  }
}
