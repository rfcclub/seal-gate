import { test, expect } from 'bun:test'
import { normalizeVerdict, worstOf, maxVerdict } from '../../src/types.ts'
import { PolicyEngine } from '../../src/engine/policy-engine.ts'
import { TrustMemory } from '../../src/trust-memory.ts'

// Review on seal-gate#19 (Mira, Lila): the old name must be read as the new one at every public verdict input,
// and only own alias keys count as aliases.
test('boundary-legacy-aggregation: the old name keeps its severity when verdicts are aggregated', () => {
  const legacy = 'ESCALATE_TO_HUMAN' as never
  expect(PolicyEngine.resolveVerdicts(['PASS', legacy]).verdict).toBe('ESCALATE_TO_REVIEWER')
  expect(PolicyEngine.resolveVerdicts([legacy, 'REVISE']).verdict).toBe('ESCALATE_TO_REVIEWER')
  expect(PolicyEngine.resolveVerdicts([legacy, 'BLOCK']).verdict).toBe('BLOCK')
  expect(worstOf('PASS', legacy)).toBe('ESCALATE_TO_REVIEWER')
  expect(worstOf(legacy, 'PASS')).toBe('ESCALATE_TO_REVIEWER')
  expect(maxVerdict('REVISE', legacy)).toBe('ESCALATE_TO_REVIEWER')
  expect(worstOf(legacy, 'BLOCK')).toBe('BLOCK')
})

test('boundary-prototype-names: inherited object property names are not verdicts or aliases', () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) expect(normalizeVerdict(name)).toBeNull()
  const record = (verdict: string) => ({ ts: 1, verdict, trust_score: 100, risk_level: 'HIGH', blocking_count: 0 })
  const mem = TrustMemory.fromJSON({ coder: [record('constructor'), { ...record('toString'), ts: 2 }, { ...record('PASS'), ts: 3 }] } as never)
  expect(mem.toJSON().coder!.map(r => r.verdict)).toEqual(['PASS'])
})
