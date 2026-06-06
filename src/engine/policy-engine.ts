import { SealIssue, SealInput, LLMSignals, Verdict, RiskLevel, maxVerdict, makeIssue } from '../types.ts'

const DESTRUCTIVE_PATTERN = /\b(DROP\s+TABLE|rm\s+-rf|DELETE\s+FROM|TRUNCATE|format\s+\/|fdisk)\b/i
const PRODUCTION_DEPLOY_PATTERN = /\b(deploy(?:ing)?|release|push to production|go live)\b/i
const MIGRATION_PATTERN = /\b(migration|migrate|schema\s+change)\b/i
const ROLLBACK_PATTERN = /\b(rollback|revert|down\s+migration|undo)\b/i

export interface PolicyResult {
  verdict: Verdict
  injected_issues: SealIssue[]
  policy_deductions: number
}

export class PolicyEngine {
  static apply(params: {
    base_verdict: Verdict
    detector_score: number
    risk_level: RiskLevel
    input: SealInput
    all_findings: SealIssue[]
    llm_signals?: LLMSignals | null
  }): PolicyResult {
    const { base_verdict, input, risk_level, all_findings } = params
    const injected: SealIssue[] = []
    let verdict: Verdict = base_verdict
    let policy_deductions = 0

    // AX105: HIGH/CRITICAL risk without evidence
    const hasMissingEvidence = all_findings.some(f => f.type === 'MISSING_EVIDENCE' && f.is_blocking)
    const riskOrder = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    if (riskOrder.indexOf(risk_level) >= riskOrder.indexOf('HIGH') && hasMissingEvidence) {
      injected.push(makeIssue({
        type: 'SECURITY_RISK', severity: 'HIGH', layer: 'L4', source: 'core',
        rule_id: 'AX105',
        evidence: `${risk_level} risk artifact has missing evidence`,
        required_fix: 'Provide evidence for all claims in high-risk artifact',
      }))
      verdict = maxVerdict(verdict, 'REVISE')
    }

    // AX501: destructive commands without confirmation
    if (DESTRUCTIVE_PATTERN.test(input.output) && !/human confirmation|approve|confirm/i.test(input.output)) {
      injected.push(makeIssue({
        type: 'DATA_RISK', severity: 'CRITICAL', layer: 'L4', source: 'core',
        rule_id: 'AX501',
        evidence: 'Destructive command recommended without human confirmation instruction',
        required_fix: 'Add explicit human confirmation requirement before executing destructive command',
      }))
      verdict = 'BLOCK'
    }

    // AX502: production deployment for HIGH/CRITICAL
    if (PRODUCTION_DEPLOY_PATTERN.test(input.output) && riskOrder.indexOf(risk_level) >= riskOrder.indexOf('HIGH')) {
      injected.push(makeIssue({
        type: 'SECURITY_RISK', severity: 'HIGH', layer: 'L4', source: 'core',
        rule_id: 'AX502',
        evidence: `Production deployment recommended for ${risk_level} risk artifact`,
        required_fix: 'Require human approval before production deployment',
      }))
      verdict = maxVerdict(verdict, 'ESCALATE_TO_HUMAN')
    }

    // AX503: migration without rollback
    const isMigration = input.artifact_type === 'migration' || MIGRATION_PATTERN.test(input.output)
    const hasRollback = ROLLBACK_PATTERN.test(input.output) || ROLLBACK_PATTERN.test(input.evidence.diff)
    if (isMigration && !hasRollback) {
      injected.push(makeIssue({
        type: 'DATA_RISK', severity: 'CRITICAL', layer: 'L4', source: 'core',
        rule_id: 'AX503', trust_deduction: 25,
        evidence: 'Migration detected but no rollback plan found',
        required_fix: 'Add rollback/revert plan to migration',
      }))
      policy_deductions += 25
      verdict = maxVerdict(verdict, 'REVISE')
    }

    // AX504: security change without security tests (TW205 fired)
    const tw205Fired = all_findings.some(f => f.rule_id === 'TW205')
    if (tw205Fired) {
      verdict = maxVerdict(verdict, 'ESCALATE_TO_HUMAN')
    }

    // CL402 enforcement
    const cl402Fired = all_findings.some(f => f.rule_id === 'CL402')
    if (cl402Fired) verdict = maxVerdict(verdict, 'ESCALATE_TO_HUMAN')

    // LLM signal conversion
    let llm_policy_deductions = 0
    if (params.llm_signals) {
      const signals = params.llm_signals
      if (signals.confidence < 0.6 && riskOrder.indexOf(risk_level) >= riskOrder.indexOf('MEDIUM')) {
        injected.push(makeIssue({
          type: 'AMBIGUITY', severity: 'MEDIUM', layer: 'L2', source: 'llm-overlay',
          rule_id: 'CL403', trust_deduction: 20,
          evidence: `LLM reviewer confidence ${signals.confidence.toFixed(2)} below threshold for ${risk_level} risk`,
        }))
        llm_policy_deductions += 20
        verdict = maxVerdict(verdict, 'ESCALATE_TO_HUMAN')
      }
    }

    // required_verdict overrides from extension/detector issues
    for (const issue of all_findings) {
      if (issue.required_verdict) {
        verdict = maxVerdict(verdict, issue.required_verdict)
      }
    }

    // BLOCK is terminal
    if (verdict === 'BLOCK') {
      // stays BLOCK
    }

    return { verdict, injected_issues: injected, policy_deductions: policy_deductions + llm_policy_deductions }
  }

  static resolveVerdicts(verdicts: Verdict[]): { verdict: Verdict } {
    const order: Verdict[] = ['PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'ESCALATE_TO_HUMAN', 'BLOCK']
    const maxIdx = Math.max(...verdicts.map(v => order.indexOf(v)))
    return { verdict: order[maxIdx] ?? 'PASS' }
  }

  static convertLLMSignals(signals: LLMSignals): SealIssue[] {
    const issues: SealIssue[] = []
    const map = [
      { field: 'suspected_issues' as const, type: 'LOGIC_BUG' as const, severity: 'MEDIUM' as const },
      { field: 'missing_requirements' as const, type: 'SPEC_MISMATCH' as const, severity: 'HIGH' as const },
      { field: 'evidence_gaps' as const, type: 'MISSING_EVIDENCE' as const, severity: 'MEDIUM' as const },
      { field: 'possible_edge_cases' as const, type: 'AMBIGUITY' as const, severity: 'LOW' as const },
    ]
    for (const { field, type, severity } of map) {
      for (const text of signals[field]) {
        issues.push(makeIssue({ type, severity, layer: 'L2', source: 'llm-overlay', evidence: text }))
      }
    }
    return issues
  }
}
