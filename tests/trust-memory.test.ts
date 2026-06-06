import { test, expect, describe } from 'bun:test'
import { TrustMemory, computeReliabilityScore, getDriftTrend, type ReviewRecord } from '../src/trust-memory.ts'

describe('TrustMemory', () => {
  test('new agent has no history and score null', () => {
    const mem = new TrustMemory()
    expect(mem.getScore('agent-x')).toBeNull()
    expect(mem.getHistory('agent-x')).toEqual([])
  })

  test('recordReview adds to history', () => {
    const mem = new TrustMemory()
    mem.record('aria', { verdict: 'PASS', trust_score: 100, risk_level: 'MEDIUM', blocking_count: 0 })
    expect(mem.getHistory('aria')).toHaveLength(1)
    expect(mem.getHistory('aria')[0].verdict).toBe('PASS')
  })

  test('history capped at maxHistory (default 50)', () => {
    const mem = new TrustMemory({ maxHistory: 3 })
    for (let i = 0; i < 5; i++) {
      mem.record('aria', { verdict: 'PASS', trust_score: 100, risk_level: 'LOW', blocking_count: 0 })
    }
    expect(mem.getHistory('aria')).toHaveLength(3)
  })

  test('most recent entry kept when capped', () => {
    const mem = new TrustMemory({ maxHistory: 2 })
    mem.record('aria', { verdict: 'BLOCK', trust_score: 10, risk_level: 'CRITICAL', blocking_count: 5 })
    mem.record('aria', { verdict: 'PASS', trust_score: 95, risk_level: 'LOW', blocking_count: 0 })
    mem.record('aria', { verdict: 'PASS_WITH_WARNINGS', trust_score: 75, risk_level: 'MEDIUM', blocking_count: 0 })
    const history = mem.getHistory('aria')
    expect(history).toHaveLength(2)
    expect(history[0].verdict).toBe('PASS') // second oldest retained
    expect(history[1].verdict).toBe('PASS_WITH_WARNINGS') // most recent
  })

  test('getScore returns 0-100 number after first record', () => {
    const mem = new TrustMemory()
    mem.record('aria', { verdict: 'PASS', trust_score: 100, risk_level: 'LOW', blocking_count: 0 })
    const score = mem.getScore('aria')
    expect(score).not.toBeNull()
    expect(score!).toBeGreaterThanOrEqual(0)
    expect(score!).toBeLessThanOrEqual(100)
  })

  test('getSummary returns agent_id, score, trend, review_count', () => {
    const mem = new TrustMemory()
    mem.record('aria', { verdict: 'PASS', trust_score: 95, risk_level: 'LOW', blocking_count: 0 })
    const summary = mem.getSummary('aria')
    expect(summary.agent_id).toBe('aria')
    expect(summary.reliability_score).not.toBeNull()
    expect(['improving', 'stable', 'degrading']).toContain(summary.drift_trend)
    expect(summary.review_count).toBe(1)
  })

  test('unknown agent summary has null score and stable trend', () => {
    const mem = new TrustMemory()
    const summary = mem.getSummary('ghost')
    expect(summary.reliability_score).toBeNull()
    expect(summary.drift_trend).toBe('stable')
    expect(summary.review_count).toBe(0)
  })
})

describe('computeReliabilityScore', () => {
  test('all PASS → score near 100', () => {
    const records: ReviewRecord[] = Array.from({ length: 5 }, () => ({
      ts: Date.now(), verdict: 'PASS' as const, trust_score: 100, risk_level: 'LOW', blocking_count: 0,
    }))
    expect(computeReliabilityScore(records)).toBeGreaterThanOrEqual(90)
  })

  test('all BLOCK → score near 0', () => {
    const records: ReviewRecord[] = Array.from({ length: 5 }, () => ({
      ts: Date.now(), verdict: 'BLOCK' as const, trust_score: 5, risk_level: 'CRITICAL', blocking_count: 3,
    }))
    expect(computeReliabilityScore(records)).toBeLessThanOrEqual(15)
  })

  test('mixed verdicts → score between extremes', () => {
    const records: ReviewRecord[] = [
      { ts: Date.now(), verdict: 'PASS', trust_score: 100, risk_level: 'LOW', blocking_count: 0 },
      { ts: Date.now(), verdict: 'BLOCK', trust_score: 10, risk_level: 'CRITICAL', blocking_count: 3 },
    ]
    const score = computeReliabilityScore(records)
    expect(score).toBeGreaterThan(10)
    expect(score).toBeLessThan(90)
  })

  test('more recent reviews weighted higher', () => {
    const now = Date.now()
    // Old records are BLOCK, recent are PASS → score should be higher than simple average
    const records: ReviewRecord[] = [
      { ts: now - 86400000 * 7, verdict: 'BLOCK', trust_score: 5, risk_level: 'CRITICAL', blocking_count: 3 },
      { ts: now - 86400000 * 6, verdict: 'BLOCK', trust_score: 5, risk_level: 'CRITICAL', blocking_count: 3 },
      { ts: now - 3600000, verdict: 'PASS', trust_score: 100, risk_level: 'LOW', blocking_count: 0 },
      { ts: now - 1800000, verdict: 'PASS', trust_score: 100, risk_level: 'LOW', blocking_count: 0 },
      { ts: now - 600000, verdict: 'PASS', trust_score: 100, risk_level: 'LOW', blocking_count: 0 },
    ]
    expect(computeReliabilityScore(records)).toBeGreaterThan(50)
  })

  test('empty records returns null', () => {
    expect(computeReliabilityScore([])).toBeNull()
  })
})

describe('getDriftTrend', () => {
  test('improving: second half better than first', () => {
    const now = Date.now()
    const records: ReviewRecord[] = [
      { ts: now - 5000, verdict: 'BLOCK', trust_score: 10, risk_level: 'CRITICAL', blocking_count: 3 },
      { ts: now - 4000, verdict: 'REVISE', trust_score: 55, risk_level: 'HIGH', blocking_count: 1 },
      { ts: now - 3000, verdict: 'PASS', trust_score: 90, risk_level: 'LOW', blocking_count: 0 },
      { ts: now - 2000, verdict: 'PASS', trust_score: 95, risk_level: 'LOW', blocking_count: 0 },
    ]
    expect(getDriftTrend(records)).toBe('improving')
  })

  test('degrading: second half worse than first', () => {
    const now = Date.now()
    const records: ReviewRecord[] = [
      { ts: now - 5000, verdict: 'PASS', trust_score: 95, risk_level: 'LOW', blocking_count: 0 },
      { ts: now - 4000, verdict: 'PASS', trust_score: 90, risk_level: 'LOW', blocking_count: 0 },
      { ts: now - 3000, verdict: 'REVISE', trust_score: 55, risk_level: 'HIGH', blocking_count: 1 },
      { ts: now - 2000, verdict: 'BLOCK', trust_score: 10, risk_level: 'CRITICAL', blocking_count: 3 },
    ]
    expect(getDriftTrend(records)).toBe('degrading')
  })

  test('stable: similar first and second halves', () => {
    const now = Date.now()
    const records: ReviewRecord[] = [
      { ts: now - 4000, verdict: 'PASS', trust_score: 90, risk_level: 'LOW', blocking_count: 0 },
      { ts: now - 3000, verdict: 'PASS', trust_score: 85, risk_level: 'LOW', blocking_count: 0 },
      { ts: now - 2000, verdict: 'PASS', trust_score: 88, risk_level: 'LOW', blocking_count: 0 },
      { ts: now - 1000, verdict: 'PASS', trust_score: 92, risk_level: 'LOW', blocking_count: 0 },
    ]
    expect(getDriftTrend(records)).toBe('stable')
  })

  test('fewer than 2 records → stable', () => {
    expect(getDriftTrend([])).toBe('stable')
    expect(getDriftTrend([{ ts: Date.now(), verdict: 'PASS', trust_score: 90, risk_level: 'LOW', blocking_count: 0 }])).toBe('stable')
  })
})
