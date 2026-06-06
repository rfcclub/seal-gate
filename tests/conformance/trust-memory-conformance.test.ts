import { test, expect } from 'bun:test'
import { computeReliabilityScore, getDriftTrend, type ReviewRecord } from '../../src/trust-memory.ts'
import fixture from './fixtures/trust-memory.json'

test('TrustMemory conformance: TS matches golden fixture', () => {
  const records = (fixture.records as ReviewRecord[])
  expect(computeReliabilityScore(records)).toBe(fixture.expected.reliability_score)
  expect(getDriftTrend(records)).toBe(fixture.expected.drift_trend)
})
