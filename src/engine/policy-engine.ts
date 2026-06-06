import { SealIssue, SealInput, LLMSignals, Verdict, RiskLevel, maxVerdict, makeIssue } from '../types.ts'

// AX501: destructive commands — requires word boundary only before, not after (/ is non-word)
const DESTRUCTIVE_PATTERN = /\b(DROP\s+TABLE|rm\s+-rf|DELETE\s+FROM|TRUNCATE|format\s+\/|fdisk)/i
// AX501: confirmation must be adjacent to the destructive command (within 100 chars)
// AX502: only explicit deployment actions, not "release notes" or "memory release"
const PRODUCTION_DEPLOY_PATTERN = /\b(deploy(?:ing)?\s+to\s+(?:prod|production)|push\s+to\s+production|go\s+live|release\s+to\s+(?:prod|production))\b/i
const MIGRATION_PATTERN = /\b(migration|migrate|schema\s+change)\b/i
// AX503: positive rollback evidence — "rollback plan", "revert migration", "down migration", "rollback script"
const ROLLBACK_PATTERN = /\b(rollback\s+(?:plan|script|procedure|step)|revert\s+(?:migration|schema|change)|down\s+migration|migration\s+rollback)\b/i

const RISK_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

function riskIdx(r: string): number {
  const idx = RISK_ORDER.indexOf(r as RiskLevel)
  return idx === -1 ? RISK_ORDER.length - 1 : idx // unknown → treat as max risk
}

function hasAdjacentConfirmation(output: string, matchStart: number): boolean {
  const window = output.slice(Math.max(0, matchStart - 150), matchStart + 150)
  return /\b(requires?\s+(?:human\s+)?(?:confirmation|approval|review)|please\s+confirm|must\s+(?:approve|confirm))\b/i.test(window)
}

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

    // Validate risk_level — unknown risk treated as CRITICAL (fail-safe)
    const riskLevelSafe: RiskLevel = RISK_ORDER.includes(risk_level as RiskLevel)
      ? risk_level
      : 'CRITICAL'

    // AX105: HIGH/CRITICAL risk without blocking missing evidence
    // Check severity directly rather than trusting is_blocking flag
    const hasMissingEvidence = all_findings.some(
      f => f.type === 'MISSING_EVIDENCE' && (f.severity === 'CRITICAL' || f.severity === 'HIGH')
    )
    if (riskIdx(riskLevelSafe) >= riskIdx('HIGH') && hasMissingEvidence) {
      injected.push(makeIssue({
        type: 'SECURITY_RISK', severity: 'HIGH', layer: 'L4', source: 'core',
        rule_id: 'AX105',
        evidence: `${riskLevelSafe} risk artifact has blocking missing evidence`,
        required_fix: 'Provide evidence for all claims in high-risk artifact',
      }))
      verdict = maxVerdict(verdict, 'REVISE')
    }

    // AX501: destructive commands — confirmation must be adjacent to the command
    const destructiveMatch = DESTRUCTIVE_PATTERN.exec(input.output)
    if (destructiveMatch && !hasAdjacentConfirmation(input.output, destructiveMatch.index)) {
      injected.push(makeIssue({
        type: 'DATA_RISK', severity: 'CRITICAL', layer: 'L4', source: 'core',
        rule_id: 'AX501',
        evidence: `Destructive command "${destructiveMatch[0]}" without adjacent human confirmation requirement`,
        required_fix: 'Add explicit human confirmation requirement immediately adjacent to destructive command',
      }))
      verdict = 'BLOCK'
    }

    // AX502: explicit production deployment for HIGH/CRITICAL
    if (PRODUCTION_DEPLOY_PATTERN.test(input.output) && riskIdx(riskLevelSafe) >= riskIdx('HIGH')) {
      injected.push(makeIssue({
        type: 'SECURITY_RISK', severity: 'HIGH', layer: 'L4', source: 'core',
        rule_id: 'AX502',
        evidence: `Production deployment action recommended for ${riskLevelSafe} risk artifact`,
        required_fix: 'Require explicit human approval before production deployment',
      }))
      verdict = maxVerdict(verdict, 'ESCALATE_TO_HUMAN')
    }

    // AX503: migration without explicit rollback plan (not just "git revert" or "cannot undo")
    const isMigration = input.artifact_type === 'migration' || MIGRATION_PATTERN.test(input.output)
    const hasRollback = ROLLBACK_PATTERN.test(input.output) || ROLLBACK_PATTERN.test(input.evidence.diff)
    if (isMigration && !hasRollback) {
      injected.push(makeIssue({
        type: 'DATA_RISK', severity: 'CRITICAL', layer: 'L4', source: 'core',
        rule_id: 'AX503', trust_deduction: 25,
        evidence: 'Migration detected but no explicit rollback plan found (requires: rollback plan/script, revert migration, or down migration)',
        required_fix: 'Add explicit rollback/revert plan to migration',
      }))
      policy_deductions += 25
      verdict = maxVerdict(verdict, 'REVISE')
    }

    // AX504: auth change without auth tests — check finding type/content, not brittle rule_id
    const hasAuthTestGap = all_findings.some(
      f => f.type === 'TEST_GAP' && f.rule_id === 'TW205'
    ) || all_findings.some(
      f => f.type === 'TEST_GAP' && /auth/i.test(f.evidence ?? '') && (f.severity === 'CRITICAL' || f.severity === 'HIGH')
    )
    if (hasAuthTestGap) {
      verdict = maxVerdict(verdict, 'ESCALATE_TO_HUMAN')
    }

    // CL402 enforcement
    const cl402Fired = all_findings.some(f => f.rule_id === 'CL402')
    if (cl402Fired) verdict = maxVerdict(verdict, 'ESCALATE_TO_HUMAN')

    // LLM signal confidence check (CL403) — guard against null/non-number
    let llm_policy_deductions = 0
    if (params.llm_signals) {
      const signals = params.llm_signals
      const confidence = typeof signals.confidence === 'number' ? signals.confidence : 1.0
      if (confidence < 0.6 && riskIdx(riskLevelSafe) >= riskIdx('MEDIUM')) {
        injected.push(makeIssue({
          type: 'AMBIGUITY', severity: 'MEDIUM', layer: 'L2', source: 'llm-overlay',
          rule_id: 'CL403', trust_deduction: 20,
          evidence: `LLM reviewer confidence ${confidence.toFixed(2)} below threshold for ${riskLevelSafe} risk`,
        }))
        llm_policy_deductions += 20
        verdict = maxVerdict(verdict, 'ESCALATE_TO_HUMAN')
      }

      // Apply LLM risk_guess if higher than detected risk
      if (signals.risk_guess && RISK_ORDER.includes(signals.risk_guess as RiskLevel)) {
        if (riskIdx(signals.risk_guess) > riskIdx(riskLevelSafe)) {
          // LLM sees higher risk — add advisory issue but don't auto-escalate
          injected.push(makeIssue({
            type: 'AMBIGUITY', severity: 'MEDIUM', layer: 'L2', source: 'llm-overlay',
            evidence: `LLM reviewer assessed risk as ${signals.risk_guess} vs deterministic ${riskLevelSafe}`,
            suggested_fix: 'Review output for additional risk signals not caught by keyword matching',
          }))
        }
      }
    }

    // Extension required_verdict: only honor BLOCK (terminal) from extensions
    // Other required_verdict values are advisory — do not let extensions set REVISE/ESCALATE directly
    const hasExtensionBlock = all_findings.some(
      f => f.source === 'extension' && f.required_verdict === 'BLOCK' && f.is_blocking
    )
    if (hasExtensionBlock) verdict = 'BLOCK'

    // BLOCK is terminal
    if (verdict === 'BLOCK') {
      // stays BLOCK — no component can downgrade
    }

    return { verdict, injected_issues: injected, policy_deductions: policy_deductions + llm_policy_deductions }
  }

  static resolveVerdicts(verdicts: Verdict[]): { verdict: Verdict } {
    const order: Verdict[] = ['PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'ESCALATE_TO_HUMAN', 'BLOCK']
    if (verdicts.length === 0) return { verdict: 'REVISE' } // empty = uncertain = at least REVISE
    const maxIdx = Math.max(...verdicts.map(v => order.indexOf(v)).filter(i => i >= 0))
    if (maxIdx < 0) return { verdict: 'REVISE' } // all invalid = uncertain
    return { verdict: order[maxIdx]! }
  }

  static convertLLMSignals(signals: LLMSignals): SealIssue[] {
    const issues: SealIssue[] = []
    const map = [
      { field: 'suspected_issues' as const,     type: 'LOGIC_BUG' as const,       severity: 'MEDIUM' as const },
      { field: 'missing_requirements' as const,  type: 'SPEC_MISMATCH' as const,   severity: 'HIGH' as const },
      { field: 'evidence_gaps' as const,         type: 'MISSING_EVIDENCE' as const, severity: 'MEDIUM' as const },
      { field: 'possible_edge_cases' as const,   type: 'AMBIGUITY' as const,        severity: 'LOW' as const },
    ]
    for (const { field, type, severity } of map) {
      const items = signals[field]
      if (!Array.isArray(items)) continue // guard against undefined/null fields
      for (const text of items) {
        if (typeof text === 'string' && text.trim()) {
          issues.push(makeIssue({ type, severity, layer: 'L2', source: 'llm-overlay', evidence: text }))
        }
      }
    }
    return issues
  }
}
