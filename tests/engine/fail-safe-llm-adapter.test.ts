import { describe, it, expect } from 'bun:test'
import { Seal } from '../../src/index.ts'
import type { LLMReviewerAdapter } from '../../src/types.ts'

// The LLM reviewer is an optional overlay (zero-config guarantee — see
// false-positive-hardening/design.md AD-3). Unlike a core detector, its
// failure is caught (src/index.ts) and degrades gracefully to an advisory
// finding + assumption note. This test locks in that the degradation is
// recorded, not silently dropped — the caller can always see L2 didn't run.
//
// Seal.withLLM() sets a module-level singleton with no public "unset" —
// restore it to null in `finally` so this test cannot leak a throwing
// adapter into other test files sharing this test run.
describe('fail-safe: LLM reviewer adapter throws', () => {
  it('degrades gracefully — verdict is still returned with the failure recorded, not a silent pass-through', async () => {
    const throwingAdapter: LLMReviewerAdapter = {
      async review() {
        throw new Error('llm reviewer boom')
      },
    }
    Seal.withLLM(throwingAdapter)

    try {
      const verdict = await Seal.review({
        artifact_type: 'llm_response',
        output: 'All tests pass. Implemented the feature.',
        evidence: { diff: '', test_log: 'PASS', build_log: '', references: [] },
      })

      expect(verdict.assumptions_detected.some(a => a.includes('LLM reviewer error'))).toBe(true)
      expect(verdict.deterministic_findings.some(f => f.evidence.includes('LLM reviewer failed'))).toBe(true)
    } finally {
      // Restore module singleton to "no LLM adapter registered" for other tests in this run.
      ;(Seal.withLLM as (a: LLMReviewerAdapter | null) => void)(null)
    }
  })
})
