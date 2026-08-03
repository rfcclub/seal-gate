import { SealIssue, makeIssue } from '../types.js'
import { mutationSurvivorEvidence } from '../spec/mutation-probe.js'

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
  /** Level 2b: does the covering test actually pin this behavior? (mutation-probe) */
  pinned?: boolean
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

  /**
   * Level 2b — `test_exercises()` mutation-probe.
   *
   * Runs the base Level 1 spec-coverage validation, then for each covered criterion where a
   * `test_file` + `run_command` is supplied, mutation-probes the test to confirm it genuinely
   * pins the behavior. A test that survives a single-point mutation (still green) does not
   * exercise the criterion — it gets downgraded and reported as SPEC_UNTESTED.
   *
   * Probe is best-effort: missing test_file / run_command / workdir ⇒ skip that criterion's
   * probe (assumption), never block the whole review.
   */
  static async validateWithProbe(
    spec: string | null,
    testLog: string,
    diff: string,
    probeOpts: Array<{
      criterion: string
      test_file: string
      run_command: [string, string[]]
      workdir: string
      _runTest?: (workdir: string, cmd: string, args: string[]) => Promise<{ exit_code: number; output: string }>
    }>,
  ): Promise<SpecCoverageResult> {
    const base = SpecCoverageValidator.validate(spec, testLog, diff)

    if (probeOpts.length === 0) return base

    const { checkTestPinsBehavior } = await import('../spec/mutation-probe.js')

    const coverage = base.coverage.map((c) => ({ ...c, pinned: undefined } as SpecCriterionResult))
    const issues = [...base.issues]
    const assumptions = [...base.assumptions]
    let trust_deductions = base.trust_deductions

    for (const opt of probeOpts) {
      const entry = coverage.find((c) => c.level === 1 && c.criterion.includes(opt.criterion.slice(0, 100)))
      if (!entry) continue // not Level-1 covered → nothing to probe

      let outcome: { pinned?: boolean; skipped?: boolean; reason?: string; survivors?: string[] }
      try {
        const res = await checkTestPinsBehavior(opt)
        if ('skipped' in res) {
          outcome = { skipped: true, reason: (res as { skipped: true; reason: string }).reason }
        } else if (res.pinned) {
          outcome = { pinned: true, survivors: [] }
        } else {
          outcome = { pinned: false, survivors: res.survivors }
        }
      } catch (e) {
        outcome = { skipped: true, reason: (e as Error).message }
      }

      if (outcome.skipped) {
        assumptions.push(`mutation-probe skipped for "${opt.criterion.slice(0, 60)}": ${outcome.reason}`)
        continue
      }

      entry.pinned = outcome.pinned

      if (outcome.pinned === false && outcome.survivors && outcome.survivors.length > 0) {
        const deduction = Math.min(8, 20 - trust_deductions)
        if (deduction > 0) {
          issues.push(makeIssue({
            type: 'SPEC_UNTESTED',
            severity: 'MEDIUM',
            layer: 'L1',
            source: 'core',
            rule_id: 'TE201',
            trust_deduction: deduction,
            evidence: `Criterion "${opt.criterion.slice(0, 80)}" is covered by a test that does NOT pin the behavior. ${mutationSurvivorEvidence(outcome.survivors)}`,
            suggested_fix: `Tighten the test for "${opt.criterion.slice(0, 80)}" so a mutation of its assertion actually fails.`,
          }))
          trust_deductions += deduction
          entry.level = 0 // downgrade: covered-in-name but not pinned
        }
      }
    }

    return { issues, assumptions, trust_deductions, coverage }
  }
}

export { breedMutations, checkTestPinsBehavior } from '../spec/mutation-probe.js'
