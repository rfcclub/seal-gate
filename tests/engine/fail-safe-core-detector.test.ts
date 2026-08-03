import { describe, it, expect } from 'bun:test'
import { Seal } from '../../src/index.ts'
import { ClaimExtractor } from '../../src/detectors/claim-extractor.ts'

// The deterministic detector pipeline in src/index.ts (Seal.review) has no
// try/catch around it — a core detector failure must propagate as a
// rejected promise, not resolve to a silent PASS. Callers (CLI's top-level
// .catch() -> exit 1; loomkit's transition-guard.ts refusing 'finish' when
// no gate_code_verdict was recorded) rely on this propagation to stay
// fail-closed. See openspec/changes/verifiable-gate-hardening/design.md AD-2.
//
// Patches ClaimExtractor.extract directly (same class object index.ts
// imports — ESM modules are singletons) and restores it in `finally` so
// this test cannot leak into other test files sharing the same run.
describe('fail-safe: core detector throws', () => {
  it('propagates the exception — Seal.review() rejects rather than returning a verdict', async () => {
    const original = ClaimExtractor.extract
    ClaimExtractor.extract = () => { throw new Error('claim-extractor exploded') }
    try {
      await expect(Seal.review({
        artifact_type: 'llm_response',
        output: 'All tests pass. Implemented the feature.',
        evidence: { diff: '', test_log: 'PASS', build_log: '', references: [] },
      })).rejects.toThrow('claim-extractor exploded')
    } finally {
      ClaimExtractor.extract = original
    }
  })
})
