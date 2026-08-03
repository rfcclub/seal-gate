import { describe, it, expect } from 'bun:test'
import { Seal } from '../../src/index.ts'
import { HeuristicScorer, AMBIGUOUS_THRESHOLD } from '../../src/engine/heuristic-scorer.ts'
import type { LLMReviewerAdapter, LLMSignals } from '../../src/types.ts'

const NEUTRAL_SIGNALS: LLMSignals = {
  suspected_issues: [],
  missing_requirements: [],
  possible_edge_cases: [],
  evidence_gaps: [],
  risk_guess: 'LOW',
  confidence: 0.9,
}

function spyAdapter() {
  let calls = 0
  const adapter: LLMReviewerAdapter = {
    async review() {
      calls++
      return NEUTRAL_SIGNALS
    },
  }
  return { adapter, callCount: () => calls }
}

describe('HeuristicScorer.isAmbiguous', () => {
  it('is false at/above the threshold, true below it', () => {
    expect(HeuristicScorer.isAmbiguous(AMBIGUOUS_THRESHOLD)).toBe(false)
    expect(HeuristicScorer.isAmbiguous(100)).toBe(false)
    expect(HeuristicScorer.isAmbiguous(AMBIGUOUS_THRESHOLD - 1)).toBe(true)
    expect(HeuristicScorer.isAmbiguous(0)).toBe(true)
  })
})

// AD-5: `--llm auto` runs the heuristic first and only calls the LLM reviewer when the
// heuristic result is ambiguous — additive, `--llm <provider>` (always-on) is unchanged.
describe('Seal.withLLM auto mode', () => {
  it('does not call the LLM reviewer when the heuristic score is unambiguous (clean input)', async () => {
    const { adapter, callCount } = spyAdapter()
    Seal.withLLM(adapter, { mode: 'auto' })
    try {
      const verdict = await Seal.review({
        artifact_type: 'llm_response',
        output: 'Implemented the feature.',
        evidence: { diff: '', test_log: 'PASS', build_log: '', references: [] },
      })
      expect(callCount()).toBe(0)
      expect(verdict.assumptions_detected.some(a => a.includes('auto mode'))).toBe(true)
    } finally {
      ;(Seal.withLLM as (a: LLMReviewerAdapter | null) => void)(null)
    }
  })

  it('calls the LLM reviewer when the heuristic score is ambiguous (missing evidence)', async () => {
    const { adapter, callCount } = spyAdapter()
    Seal.withLLM(adapter, { mode: 'auto' })
    try {
      await Seal.review({
        artifact_type: 'llm_response',
        output: 'Refactored the payment migration and rollback logic without adding tests.',
        risk_hint: 'CRITICAL',
        evidence: { diff: '', test_log: '', build_log: '', references: [] },
      })
      expect(callCount()).toBeGreaterThan(0)
    } finally {
      ;(Seal.withLLM as (a: LLMReviewerAdapter | null) => void)(null)
    }
  })

  it('always-on mode (default, no opts) is unchanged — LLM reviewer always called regardless of score', async () => {
    const { adapter, callCount } = spyAdapter()
    Seal.withLLM(adapter)
    try {
      await Seal.review({
        artifact_type: 'llm_response',
        output: 'Implemented the feature.',
        evidence: { diff: '', test_log: 'PASS', build_log: '', references: [] },
      })
      expect(callCount()).toBe(1)
    } finally {
      ;(Seal.withLLM as (a: LLMReviewerAdapter | null) => void)(null)
    }
  })
})
