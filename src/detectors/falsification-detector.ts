import { SealIssue, SealInput } from '../types.js'

export const FALSIFICATION_PROBES = [
  {
    id: 'failure_mode',
    question: 'What is the worst input, unhandled state, or concurrent case this plan does not address?',
  },
  {
    id: 'assumption_collapse',
    question: 'Which stated assumption, if false, breaks the plan entirely?',
  },
  {
    id: 'missing_step',
    question: 'What must hold between step K and K+1 that is never established by the plan?',
  },
  {
    id: 'reversibility',
    question: 'Which actions are irreversible and ungated by a human sign-off or rollback procedure?',
  },
] as const

export type ProbeId = typeof FALSIFICATION_PROBES[number]['id']

export interface FalsificationProbeResult {
  probe: ProbeId
  finding: string
  evidence_file?: string
  evidence_lines?: number[]
  confidence: number
}

export interface FalsificationAdapter {
  runProbes(
    input: SealInput,
    probes: typeof FALSIFICATION_PROBES,
  ): Promise<FalsificationProbeResult[]>
}

let adapter: FalsificationAdapter | null = null

export const FalsificationDetector = {
  withAdapter(a: FalsificationAdapter): void {
    adapter = a
  },

  async detect(input: SealInput): Promise<SealIssue[]> {
    if (!adapter) {
      // No LLM adapter registered — Stage 4 skipped (by design, not an error)
      return []
    }

    const results = await adapter.runProbes(input, FALSIFICATION_PROBES)
    const issues: SealIssue[] = []

    for (const result of results) {
      if (!result.finding || result.finding.trim().length < 10) continue

      const hasLocation = !!(result.evidence_file && result.evidence_lines && result.evidence_lines.length > 0)
      // Cap rule: no file+line citation → stays weak (REVISE max), cannot block
      const severity = hasLocation && result.confidence >= 0.8 ? 'HIGH' : 'MEDIUM'
      const required_verdict = hasLocation ? 'REVISE' : undefined

      issues.push({
        type: 'LOGIC_BUG',
        severity,
        is_blocking: false, // falsification findings are never auto-blocking (cap rule)
        layer: 'LLM_OVERLAY',
        source: 'llm-overlay',
        rule_id: `PR004:${result.probe}`,
        required_verdict,
        evidence: `[${result.probe}] ${result.finding}`,
        evidence_file: result.evidence_file,
        evidence_lines: result.evidence_lines,
        confidence: result.confidence,
        policy_tags: ['falsification', result.probe],
        trust_deduction: hasLocation ? 8 : 3,
      })
    }

    return issues
  },
}
