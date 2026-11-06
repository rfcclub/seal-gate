import { test, expect } from 'bun:test'
import { verdictFromScore, NEXT_ACTION, VERDICT_ORDER, normalizeVerdict } from '../../src/types.ts'
import { TrustMemory } from '../../src/trust-memory.ts'

// The uncertain verdict hands the evidence to an independent reviewer; it does not default the work to a human.
test('reviewer-verdict-band: the 30–49 band, ordering and next action use the reviewer name', () => {
  expect(verdictFromScore(40, false)).toBe('ESCALATE_TO_REVIEWER')
  expect(VERDICT_ORDER).toEqual(['PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'ESCALATE_TO_REVIEWER', 'BLOCK'])
  expect(NEXT_ACTION.ESCALATE_TO_REVIEWER).toContain('independent reviewer')
  expect(NEXT_ACTION.ESCALATE_TO_REVIEWER.toLowerCase()).not.toContain('human')
})

test('reviewer-verdict-alias: the old name is read as the new one and nothing else is renamed', () => {
  expect(normalizeVerdict('ESCALATE_TO_HUMAN')).toBe('ESCALATE_TO_REVIEWER')
  expect(normalizeVerdict('ESCALATE_TO_REVIEWER')).toBe('ESCALATE_TO_REVIEWER')
  for (const v of ['PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'BLOCK']) expect(normalizeVerdict(v)).toBe(v)
  expect(normalizeVerdict('NONSENSE')).toBeNull()
  expect(normalizeVerdict(7)).toBeNull()
})

test('reviewer-verdict-stored: stored trust memory with the old name loads as the new one', () => {
  const record = (verdict: string) => ({ ts: 1, verdict, trust_score: 75, risk_level: 'HIGH', blocking_count: 0 })
  const mem = TrustMemory.fromJSON({ coder: [record('ESCALATE_TO_HUMAN'), { ...record('ESCALATE_TO_REVIEWER'), ts: 2 }, { ...record('NONSENSE'), ts: 3 }] } as never)
  const stored = mem.toJSON().coder!
  expect(stored.map(r => r.verdict)).toEqual(['ESCALATE_TO_REVIEWER', 'ESCALATE_TO_REVIEWER'])
})
