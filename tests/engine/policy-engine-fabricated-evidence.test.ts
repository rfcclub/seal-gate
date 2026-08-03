import { describe, it, expect } from 'bun:test'
import { PolicyEngine } from '../../src/engine/policy-engine.ts'
import { makeIssue, SealInput, SealIssue } from '../../src/types.ts'

const BASE_INPUT: SealInput = {
  artifact_type: 'code_diff',
  spec: null,
  output: 'Implemented the feature.',
  evidence: { diff: '', test_log: '', build_log: '', references: [] },
  risk_hint: null,
}

// Discovering a detector's citation was fabricated (see citation-verifier.ts + design.md AD-3)
// must actually change the verdict, not just appear in a side-channel report field — otherwise
// proving a claim false has zero effect on the gate, which defeats the point of checking at all.
describe('PolicyEngine — FABRICATED_EVIDENCE escalation', () => {
  it('escalates to human when a FABRICATED_EVIDENCE finding is present', () => {
    const fabricated: SealIssue = makeIssue({
      type: 'FABRICATED_EVIDENCE',
      severity: 'CRITICAL',
      layer: 'L3',
      source: 'core',
      evidence: 'Detector claimed citation at app.ts:99 but it was location_not_found',
    })

    const result = PolicyEngine.apply({
      base_verdict: 'PASS',
      detector_score: 90,
      risk_level: 'LOW',
      input: BASE_INPUT,
      all_findings: [fabricated],
    })

    expect(result.verdict).toBe('ESCALATE_TO_HUMAN')
  })

  it('does not escalate when there is no FABRICATED_EVIDENCE finding', () => {
    const result = PolicyEngine.apply({
      base_verdict: 'PASS',
      detector_score: 90,
      risk_level: 'LOW',
      input: BASE_INPUT,
      all_findings: [],
    })

    expect(result.verdict).toBe('PASS')
  })
})
