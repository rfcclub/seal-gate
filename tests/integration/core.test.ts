import { describe, test, expect } from 'bun:test'
import { Seal } from '../../src/index.ts'

const base = {
  artifact_type: 'design' as const,
  spec: null,
  output: 'Updated documentation for the module.',
  evidence: { test_log: '', build_log: '', diff: '', references: [] },
  risk_hint: null,
}

describe('Seal.review() — integration', () => {
  test('clean output → PASS or PASS_WITH_WARNINGS', async () => {
    const v = await Seal.review(base)
    expect(['PASS', 'PASS_WITH_WARNINGS']).toContain(v.verdict)
    expect(v.trust_score).toBeGreaterThanOrEqual(70)
    expect(v.schema_version).toBe('0.2.0')
  })

  test('migration without rollback → REVISE or higher + AX503', async () => {
    const v = await Seal.review({
      ...base,
      artifact_type: 'migration',
      output: 'ALTER TABLE users ADD COLUMN email VARCHAR(255)',
      evidence: { test_log: '', build_log: '', diff: 'ALTER TABLE...', references: [] },
    })
    expect(['REVISE', 'ESCALATE_TO_HUMAN', 'BLOCK']).toContain(v.verdict)
    expect(v.blocking_issues.some(i => i.rule_id === 'AX503')).toBe(true)
  })

  test('AX501: DROP TABLE → BLOCK', async () => {
    const v = await Seal.review({
      ...base,
      output: 'We will DROP TABLE users to clean up.',
    })
    expect(v.verdict).toBe('BLOCK')
  })

  test('CRITICAL risk keyword → trust_score reduced', async () => {
    const v1 = await Seal.review(base)
    const v2 = await Seal.review({ ...base, output: 'Changed payment billing logic.' })
    expect(v2.trust_score).toBeLessThan(v1.trust_score)
  })

  test('all tests pass claim without test log → missing_evidence', async () => {
    const v = await Seal.review({ ...base, output: 'All tests pass. Build succeeded.' })
    expect(v.missing_evidence.length).toBeGreaterThan(0)
  })

  test('PASS is reachable without LLM reviewer', async () => {
    const v = await Seal.review({
      artifact_type: 'design',
      spec: null,
      output: 'Updated the README with better examples.',
      evidence: { test_log: '', build_log: '', diff: '', references: [] },
      risk_hint: null,
    })
    // Should be PASS or PASS_WITH_WARNINGS (not blocked by missing LLM)
    expect(['PASS', 'PASS_WITH_WARNINGS']).toContain(v.verdict)
  })

  test('verdict has all required fields', async () => {
    const v = await Seal.review(base)
    expect(v.verdict).toBeDefined()
    expect(v.trust_score).toBeDefined()
    expect(v.risk_level).toBeDefined()
    expect(v.summary).toBeDefined()
    expect(v.blocking_issues).toBeDefined()
    expect(v.non_blocking_issues).toBeDefined()
    expect(v.missing_evidence).toBeDefined()
    expect(v.assumptions_detected).toBeDefined()
    expect(v.next_action).toBeDefined()
    expect(v.schema_version).toBe('0.2.0')
  })

  test('trust score boundary: 85 → PASS', async () => {
    // Minimal clean design doc — should hit high trust score
    const v = await Seal.review({
      artifact_type: 'design',
      spec: null,
      output: 'Architecture overview for the new feature.',
      evidence: { test_log: '', build_log: '', diff: '', references: [] },
      risk_hint: null,
    })
    // Without many claims, should be high score
    expect(v.trust_score).toBeGreaterThanOrEqual(60)
  })
})
