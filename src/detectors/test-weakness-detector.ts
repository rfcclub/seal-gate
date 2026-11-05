import { SealIssue, ArtifactType, RiskLevel, SealEvidence, RegressionEvidence, AssertionRecord } from '../types.js'
import { makeIssue } from '../types.js'
import { changedText } from './diff-lines.js'

const NEGATIVE_TEST_PATTERN = /\b(fail|error|exception|invalid|unauthorized|forbidden|edge|negative|reject|timeout|backoff)\b/i
const RETRY_PATTERN = /\b(retry|retries|exponential.?backoff|timeout|circuit.?breaker)\b/i
const SHA256 = /^[a-f0-9]{64}$/
const BUG_FIX_PATTERN = /\b(fix(?:ed)?|bug|defect|regression)\b/i
// Auth test evidence: literal keywords + semantic equivalents (budget exhausted, no candidate, access denied, etc.)
const AUTH_UNAUTH_PATTERN = /\b(unauthorized|forbidden|403|401|permission.?denied|access.?denied|exhausted|no (?:candidate|access|permission)|not (?:allowed|permitted|authorized)|reject(?:ed)?(?:\s+\w+)?\s*(?:access|action|request))\b/i

/** One assertion failed in RED and passed in GREEN, same test file and content. */
export function hasRegressionEvidence(regression: RegressionEvidence | undefined): boolean {
  if (!regression || !Array.isArray(regression.red) || !Array.isArray(regression.green)) return false
  const valid = (a: AssertionRecord | undefined) => typeof a?.test === 'string' && a.test !== '' &&
    typeof a.name === 'string' && a.name !== '' && typeof a.test_sha256 === 'string' && SHA256.test(a.test_sha256)
  return regression.red.some(r => valid(r) && r.status === 'failed' &&
    regression.green.some(g => valid(g) && g.status === 'passed' && g.test === r.test && g.name === r.name && g.test_sha256 === r.test_sha256))
}

export interface TestWeaknessResult {
  issues: SealIssue[]
  trust_deductions: number
}

export class TestWeaknessDetector {
  static detect(params: {
    artifact_type: ArtifactType
    output: string
    risk_level: RiskLevel
    auth_flagged: boolean
  }, evidence: SealEvidence): TestWeaknessResult {
    const { artifact_type, output, risk_level, auth_flagged } = params
    const { test_log } = evidence
    const changed = changedText(output, evidence.diff)
    const issues: SealIssue[] = []
    let trust_deductions = 0

    // TW201: implementation without tests
    const isImpl = artifact_type === 'code_diff' || artifact_type === 'llm_response'
    if (isImpl && test_log.trim() === '') {
      issues.push(makeIssue({
        type: 'TEST_GAP', severity: 'HIGH', layer: 'L4', source: 'core',
        rule_id: 'TW201', trust_deduction: 15,
        evidence: 'Implementation artifact has no test evidence',
        required_fix: 'Provide test_log demonstrating test coverage',
      }))
      trust_deductions += 15
    }

    // TW202: happy path only for MEDIUM+ risk
    const riskOrder = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    const isMediumPlus = riskOrder.indexOf(risk_level) >= riskOrder.indexOf('MEDIUM')
    if (isMediumPlus && test_log.trim().length > 0 && !NEGATIVE_TEST_PATTERN.test(test_log)) {
      issues.push(makeIssue({
        type: 'TEST_GAP', severity: 'MEDIUM', layer: 'L4', source: 'core',
        rule_id: 'TW202', trust_deduction: 10,
        evidence: `Tests appear to cover happy path only for ${risk_level} risk artifact`,
        suggested_fix: 'Add negative cases, error scenarios, or edge cases',
      }))
      trust_deductions += 10
    }

    // TW203: bug fix without regression test
    if (BUG_FIX_PATTERN.test(changed) && test_log.trim().length > 0 && !hasRegressionEvidence(evidence.regression)) {
      issues.push(makeIssue({
        type: 'TEST_GAP', severity: 'HIGH', layer: 'L4', source: 'core',
        rule_id: 'TW203',
        evidence: 'Bug fix detected but evidence.regression has no assertion that failed before the fix and passes after it',
        required_fix: 'Record the failing run before the fix and the passing run after it (Orca: record-red, then verify) and pass both as evidence.regression',
      }))
    }

    // TW204: retry logic without failure/timeout test
    if (RETRY_PATTERN.test(changed) && test_log.trim().length > 0 && !NEGATIVE_TEST_PATTERN.test(test_log)) {
      issues.push(makeIssue({
        type: 'TEST_GAP', severity: 'MEDIUM', layer: 'L4', source: 'core',
        rule_id: 'TW204',
        evidence: 'Retry/timeout logic detected but no failure/timeout test evidence',
        suggested_fix: 'Add tests for timeout and failure scenarios',
      }))
    }

    // TW205: auth change without unauthorized test
    if (auth_flagged && test_log.trim().length > 0 && !AUTH_UNAUTH_PATTERN.test(test_log)) {
      issues.push(makeIssue({
        type: 'TEST_GAP', severity: 'CRITICAL', layer: 'L4', source: 'core',
        rule_id: 'TW205', required_verdict: 'ESCALATE_TO_HUMAN',
        evidence: 'Auth-related change detected but no unauthorized/forbidden test evidence',
        required_fix: 'Add tests for unauthorized and forbidden access scenarios',
      }))
    }

    return { issues, trust_deductions }
  }
}
