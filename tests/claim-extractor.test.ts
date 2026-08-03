import { describe, test, expect } from 'bun:test'
import { ClaimExtractor } from '../src/detectors/claim-extractor.ts'

describe('ClaimExtractor', () => {
  test('detects test_result_claim', () => {
    const claims = ClaimExtractor.extract('All tests pass.')
    expect(claims.some(c => c.type === 'test_result_claim')).toBe(true)
  })

  test('detects build_claim', () => {
    const claims = ClaimExtractor.extract('Build succeeded.')
    expect(claims.some(c => c.type === 'build_claim')).toBe(true)
  })

  test('detects implementation_claim', () => {
    const claims = ClaimExtractor.extract('I implemented the feature.')
    expect(claims.some(c => c.type === 'implementation_claim')).toBe(true)
  })

  test('detects risk_claim', () => {
    const claims = ClaimExtractor.extract('This change is safe to deploy.')
    expect(claims.some(c => c.type === 'risk_claim')).toBe(true)
  })

  test('does not false-positive on bare safe/secure', () => {
    const claims = ClaimExtractor.extract('This change is secure.')
    expect(claims.some(c => c.type === 'risk_claim')).toBe(false)
  })

  test('detects no security impact as risk_claim', () => {
    const claims = ClaimExtractor.extract('There is no security impact from this change.')
    expect(claims.some(c => c.type === 'risk_claim')).toBe(true)
  })

  test('ignores claims in code blocks', () => {
    const claims = ClaimExtractor.extract('```\nall tests pass\n```')
    expect(claims).toHaveLength(0)
  })

  test('ignores claims in inline code', () => {
    const claims = ClaimExtractor.extract('Use `tested` as parameter name')
    expect(claims).toHaveLength(0)
  })

  test('returns claims sorted by start_pos', () => {
    const claims = ClaimExtractor.extract('Build succeeded and all tests pass.')
    const positions = claims.map(c => c.start_pos)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  test('all claims have requires_evidence: true', () => {
    const claims = ClaimExtractor.extract('implemented and tested')
    expect(claims.every(c => c.requires_evidence)).toBe(true)
  })

  test('no duplicates for same text', () => {
    const claims = ClaimExtractor.extract('tested')
    const types = claims.map(c => c.type)
    expect(new Set(types).size).toBe(types.length)
  })
})
