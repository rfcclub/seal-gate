import { describe, it, expect } from 'bun:test'
import { ConfidenceLanguageDetector } from '../../src/detectors/confidence-language-detector.ts'
import { RiskLevel, SealEvidence, StructuralClaim } from '../../src/types.ts'

function makeEvidence(overrides: Partial<SealEvidence> = {}): SealEvidence {
  return {
    test_log: '',
    build_log: '',
    diff: '',
    references: [],
    ...overrides,
  }
}

describe('ConfidenceLanguageDetector — 5 groups A-E', () => {
  describe('Group A — Completeness', () => {
    it('deducts for "fully implemented"', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: 'This is fully implemented now',
        risk_level: 'MEDIUM',
        evidence: makeEvidence(),
        deduped_spans: new Set(),
      })
      expect(result.trust_deductions).toBeGreaterThanOrEqual(5)
      expect(result.matched_groups.some(g => g.group === 'A')).toBe(true)
    })

    it('deducts for "handles all edge cases"', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: 'The code handles all edge cases',
        risk_level: 'LOW',
        evidence: makeEvidence(),
        deduped_spans: new Set(),
      })
      expect(result.matched_groups.some(g => g.group === 'A')).toBe(true)
      expect(result.trust_deductions).toBeGreaterThanOrEqual(5)
    })
  })

  describe('Group B — Correctness', () => {
    it('creates MISSING_EVIDENCE when "all tests pass" without test_log', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: 'All tests pass after the fix',
        risk_level: 'MEDIUM',
        evidence: makeEvidence({ test_log: '' }),
        deduped_spans: new Set(),
      })
      expect(result.matched_groups.some(g => g.group === 'B')).toBe(true)
      expect(result.issues.some(i => i.type === 'MISSING_EVIDENCE')).toBe(true)
    })

    it('does not create issue when test_log is present', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: 'All tests pass after the fix',
        risk_level: 'MEDIUM',
        evidence: makeEvidence({ test_log: '✓ all tests passed\n✓ login works' }),
        deduped_spans: new Set(),
      })
      expect(result.issues.filter(i => i.rule_id?.startsWith('CL-B')).length).toBe(0)
    })
  })

  describe('Group C — Security', () => {
    it('creates HIGH MISSING_EVIDENCE for "secure" without security evidence', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: 'The system is secure',
        risk_level: 'MEDIUM',
        evidence: makeEvidence({ test_log: '' }),
        deduped_spans: new Set(),
      })
      const secIssues = result.issues.filter(i => i.rule_id?.startsWith('CL-C'))
      expect(secIssues.length).toBeGreaterThanOrEqual(1)
      expect(secIssues[0].severity).toBe('HIGH')
    })

    it('does not create issue when security evidence exists', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: 'The system is secure',
        risk_level: 'MEDIUM',
        evidence: makeEvidence({ test_log: 'security audit passed, no vulnerabilities found' }),
        deduped_spans: new Set(),
      })
      expect(result.issues.filter(i => i.rule_id?.startsWith('CL-C')).length).toBe(0)
    })
  })

  describe('Group D — Compatibility', () => {
    it('creates COMPATIBILITY_RISK when endpoint changes exist', () => {
      const structuralClaims: StructuralClaim[] = [
        { type: 'structural_endpoint', target: '/api/users', line: 1, description: 'new endpoint' },
      ]
      const result = ConfidenceLanguageDetector.detect({
        output: 'Backward compatible change',
        risk_level: 'MEDIUM',
        evidence: makeEvidence({ test_log: '', diff: '' }),
        deduped_spans: new Set(),
        structural_claims: structuralClaims,
      })
      const compatIssues = result.issues.filter(i => i.type === 'COMPATIBILITY_RISK')
      expect(compatIssues.length).toBeGreaterThanOrEqual(1)
    })

    it('does not create COMPATIBILITY_RISK when no endpoint changes', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: 'Backward compatible refactor',
        risk_level: 'MEDIUM',
        evidence: makeEvidence({ diff: 'some internal change' }),
        deduped_spans: new Set(),
        structural_claims: [],
      })
      expect(result.issues.filter(i => i.type === 'COMPATIBILITY_RISK').length).toBe(0)
    })
  })

  describe('Group E — Readiness', () => {
    it('creates MISSING_EVIDENCE for "production ready" at HIGH risk', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: 'This is production ready',
        risk_level: 'HIGH',
        evidence: makeEvidence(),
        deduped_spans: new Set(),
      })
      const readinessIssues = result.issues.filter(i => i.rule_id?.startsWith('CL-E'))
      expect(readinessIssues.length).toBeGreaterThanOrEqual(1)
    })

    it('does not create issue at LOW risk', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: 'This is production ready',
        risk_level: 'LOW',
        evidence: makeEvidence(),
        deduped_spans: new Set(),
      })
      // At LOW risk with no evidence, still deducts but no blocking issue
      expect(result.issues.filter(i => i.rule_id?.startsWith('CL-E')).length).toBe(0)
    })
  })

  describe('CL401/CL402 backward compatibility', () => {
    it('adds CL401 advisory note for low evidence + overconfident patterns', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: 'Fully implemented and verified correct',
        risk_level: 'MEDIUM',
        evidence: makeEvidence(),
        deduped_spans: new Set(),
      })
      expect(result.advisory_notes.some(n => n.includes('CL401'))).toBe(true)
    })
  })

  describe('Multiple matches advisory', () => {
    it('adds advisory note for 3+ matches at HIGH risk', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: 'Fully implemented. All tests pass. Production ready. Backward compatible. Secure.',
        risk_level: 'HIGH',
        evidence: makeEvidence({ test_log: 'some test' }), // has test evidence so Group B doesn't fire
        deduped_spans: new Set(),
      })
      expect(result.advisory_notes.some(n => n.includes('Multiple overconfident patterns'))).toBe(true)
    })
  })

  describe('Edge cases', () => {
    it('handles empty output', () => {
      const result = ConfidenceLanguageDetector.detect({
        output: '',
        risk_level: 'LOW',
        evidence: makeEvidence(),
        deduped_spans: new Set(),
      })
      expect(result.issues.length).toBe(0)
      expect(result.trust_deductions).toBe(0)
    })
  })
})
