import { describe, test, expect } from 'bun:test'
import { worstOf, VERDICT_ORDER, Verdict } from '../../src/types.ts'
import { Seal } from '../../src/index.ts'

// Bug 1: maxVerdict → worstOf semantic safety
describe('worstOf — semantic verdict comparison', () => {
  test('worstOf picks BLOCK over PASS regardless of ordering', () => {
    expect(worstOf('PASS', 'BLOCK')).toBe('BLOCK')
    expect(worstOf('BLOCK', 'PASS')).toBe('BLOCK')
  })

  test('worstOf picks correct worst across all pairs', () => {
    const order = VERDICT_ORDER
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        const expected = order[Math.max(i, j)]!
        expect(worstOf(order[i]!, order[j]!)).toBe(expected)
      }
    }
  })

  test('VERDICT_ORDER is in correct ascending severity', () => {
    // If this fails, all verdict comparisons are broken — canary test
    expect(VERDICT_ORDER).toEqual([
      'PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'ESCALATE_TO_HUMAN', 'BLOCK'
    ])
  })

  test('worstOf is commutative', () => {
    const pairs: [Verdict, Verdict][] = [
      ['PASS', 'REVISE'], ['BLOCK', 'ESCALATE_TO_HUMAN'], ['PASS_WITH_WARNINGS', 'PASS'],
    ]
    for (const [a, b] of pairs) {
      expect(worstOf(a, b)).toBe(worstOf(b, a))
    }
  })
})

// Bug 2: Evidence bonus gated on EvidenceValidator pass
describe('evidence bonus — gated on validator', () => {
  test('non-empty test_log with PASSING exit code awards evidence bonus', async () => {
    const withPassingEvidence = await Seal.review({
      artifact_type: 'code_diff',
      spec: null,
      output: 'Added null check.',
      evidence: {
        test_log: 'PASS: 10 tests', build_log: '', diff: 'diff content',
        references: [{ type: 'command', command: 'bun test', exit_code: 0, output: '10 pass 0 fail' }],
      },
      risk_hint: null,
    })
    const withoutEvidence = await Seal.review({
      artifact_type: 'code_diff',
      spec: null,
      output: 'Added null check.',
      evidence: { test_log: '', build_log: '', diff: '', references: [] },
      risk_hint: null,
    })
    // Artifact with valid evidence should score higher (bonus applied)
    expect(withPassingEvidence.trust_score).toBeGreaterThan(withoutEvidence.trust_score)
  })

  test('failing command reference (exit_code 1) does NOT award evidence bonus — passing command does', async () => {
    const base = {
      artifact_type: 'code_diff' as const,
      spec: null,
      output: 'Added null check to avoid NPE.',
      evidence: { test_log: '', build_log: '', diff: '' },
      risk_hint: null,
    }
    const withPassingRef = await Seal.review({
      ...base,
      evidence: { ...base.evidence, references: [{ type: 'command' as const, command: 'bun test', exit_code: 0, output: '10 pass 0 fail' }] },
    })
    const withFailingRef = await Seal.review({
      ...base,
      evidence: { ...base.evidence, references: [{ type: 'command' as const, command: 'bun test', exit_code: 1, output: '3 fail 7 pass' }] },
    })
    // Passing reference earns +5 bonus; failing reference does not — score must differ
    expect(withPassingRef.trust_score).toBeGreaterThan(withFailingRef.trust_score)
  })
})

// Bug 3: CL401 overconfident language → advisory only, not score deduction
describe('CL401 — overconfident language is advisory, not score deduction', () => {
  test('overconfident language without evidence appears in advisory_notes not blocking_issues', async () => {
    const v = await Seal.review({
      artifact_type: 'design',
      spec: null,
      output: 'This is definitely production-ready and fully tested.',
      evidence: { test_log: '', build_log: '', diff: '', references: [] },
      risk_hint: null,
    })
    // CL401 should NOT be in blocking_issues
    expect(v.blocking_issues.some(i => i.rule_id === 'CL401')).toBe(false)
    // CL401 should appear in advisory_notes (new field)
    expect(v.advisory_notes?.some((n: string) => n.includes('CL401') || n.includes('overconfident'))).toBe(true)
  })

  test('overconfident language does not deduct from trust_score', async () => {
    const confident = await Seal.review({
      artifact_type: 'design',
      spec: null,
      output: 'This is definitely working correctly.',
      evidence: { test_log: '', build_log: '', diff: '', references: [] },
      risk_hint: null,
    })
    const neutral = await Seal.review({
      artifact_type: 'design',
      spec: null,
      output: 'This change updates the module.',
      evidence: { test_log: '', build_log: '', diff: '', references: [] },
      risk_hint: null,
    })
    // Score should be equal — confidence language no longer deducts
    expect(confident.trust_score).toBe(neutral.trust_score)
  })

  test('CL402 hedging on HIGH risk still escalates (unchanged)', async () => {
    const v = await Seal.review({
      artifact_type: 'code_diff',
      spec: null,
      output: 'This should work for the auth flow. It probably handles edge cases.',
      evidence: { test_log: '', build_log: '', diff: 'auth change', references: [] },
      risk_hint: 'HIGH',
    })
    // CL402 behavior unchanged — hedging on HIGH risk still escalates
    expect(['ESCALATE_TO_HUMAN', 'BLOCK']).toContain(v.verdict)
  })
})
