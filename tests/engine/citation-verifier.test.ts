import { describe, it, expect } from 'bun:test'
import { CitationVerifier, CitationVerdict, AbsencePattern, FabricatedEvidenceEntry } from '../../src/engine/citation-verifier.ts'
import { makeIssue, SealIssue } from '../../src/types.ts'

const ARTIFACT = `function login() {\n  const token = jwt.sign(payload, secret)\n  return token\n}\n\napp.get('/api/data', authMiddleware, handler)`

function makeTestIssue(overrides: Partial<SealIssue> = {}): SealIssue {
  return makeIssue({
    type: 'LOGIC_BUG',
    severity: 'HIGH',
    layer: 'L1',
    source: 'core',
    evidence: 'test evidence',
    ...overrides,
  })
}

describe('CitationVerifier — fuzzy match', () => {
  it('verified on high similarity literal excerpt (score >= 0.90)', () => {
    const issue = makeTestIssue({
      evidence_file: 'app.ts',
      evidence_lines: [2],
      evidence_quote: 'const token = jwt.sign(payload, secret)',
    })
    const result = CitationVerifier.verify(issue, ARTIFACT, 'app.ts')
    expect(result.status).toBe('verified')
    expect(result.quality).toBe('strong')
    expect(result.similarScore).toBeGreaterThanOrEqual(0.90)
    expect(result.isFabricated).toBe(false)
  })

  it('void on low similarity (score < 0.60)', () => {
    const issue = makeTestIssue({
      evidence_file: 'app.ts',
      evidence_lines: [2],
      evidence_quote: 'completely different text not in the artifact',
    })
    const result = CitationVerifier.verify(issue, ARTIFACT, 'app.ts')
    expect(result.status).toBe('void')
    expect(result.quality).toBe('none')
    expect(result.isFabricated).toBe(true)
    expect(result.fabricatedReason).toBe('content_mismatch')
  })

  it('drifted on medium similarity (0.60–0.89)', () => {
    const issue = makeTestIssue({
      evidence_file: 'app.ts',
      evidence_lines: [2],
      evidence_quote: 'const token = jwt.verify(payload)',
    })
    const result = CitationVerifier.verify(issue, ARTIFACT, 'app.ts')
    expect(result.status).toBe('drifted')
    expect(result.quality).toBe('weak')
    expect(result.similarScore).toBeGreaterThanOrEqual(0.60)
    expect(result.similarScore).toBeLessThan(0.90)
    expect(result.isFabricated).toBe(false)  // drifted = not fabricated, just imprecise
  })

  it('phantom on non-existent lines', () => {
    const issue = makeTestIssue({
      evidence_file: 'app.ts',
      evidence_lines: [99],
      evidence_quote: 'anything',
    })
    const result = CitationVerifier.verify(issue, ARTIFACT, 'app.ts')
    expect(result.status).toBe('phantom')
    expect(result.quality).toBe('none')
    expect(result.isFabricated).toBe(true)
    expect(result.fabricatedReason).toBe('location_not_found')
  })

  it('not_applicable when no evidence fields', () => {
    const issue = makeTestIssue({})  // no evidence_file, evidence_lines, evidence_quote
    const result = CitationVerifier.verify(issue, ARTIFACT, 'app.ts')
    expect(result.status).toBe('not_applicable')
    expect(result.isFabricated).toBe(false)
  })

  it('not_applicable when evidence_file does not match artifact file', () => {
    const issue = makeTestIssue({
      evidence_file: 'other.ts',
      evidence_lines: [1],
      evidence_quote: 'anything',
    })
    const result = CitationVerifier.verify(issue, ARTIFACT, 'app.ts')
    expect(result.status).toBe('not_applicable')
  })

  it('handles empty artifact gracefully', () => {
    const issue = makeTestIssue({
      evidence_file: 'empty.ts',
      evidence_lines: [1],
      evidence_quote: 'anything',
    })
    const result = CitationVerifier.verify(issue, '', 'empty.ts')
    // Empty string splits to [''] — line 1 exists (empty line) but quote doesn't match
    expect(result.status).toBe('void')
  })
})

describe('CitationVerifier — absence mode', () => {
  const patterns: AbsencePattern[] = [
    { positive: /\b(function|endpoint|route)\b/i, negated: /\b(auth|guard|middleware)\b/i, label: 'auth' },
  ]

  it('verified when absence is confirmed (positive anchor present, negated absent)', () => {
    // ARTIFACT line 1: "function login()" — has "function", no "auth/guard/middleware" on that line
    // But we check the WHOLE artifact, and line 3 has authMiddleware
    // So let's use a specific artifact without auth
    const artifactNoAuth = 'function login() {\n  const token = jwt.sign(payload, secret)\n  return token\n}\n'
    const issue = makeTestIssue({
      type: 'SECURITY_RISK' as any,
      evidence_file: 'app.ts',
      evidence_lines: [1],
      evidence_quote: 'no auth guard on login endpoint',
    })
    const result = CitationVerifier.verify(issue, artifactNoAuth, 'app.ts', { absencePatterns: patterns })
    expect(result.status).toBe('verified')
    expect(result.quality).toBe('strong')
  })

  it('void when negated token IS present (detector wrong about absence)', () => {
    // ARTIFACT line 3: "app.get('/api/data', authMiddleware, handler)" — has both endpoint AND auth
    // Use a pattern that catches compound words like "authMiddleware"
    const compoundPatterns: AbsencePattern[] = [
      { positive: /\b(function|endpoint|route|app\.(get|post|put|delete|patch))\b/i, negated: /auth|guard|middleware|authenticate|authorize/i, label: 'auth' },
    ]
    const issue = makeTestIssue({
      evidence_file: 'app.ts',
      evidence_lines: [3],
      evidence_quote: 'no auth check on this endpoint',
    })
    const result = CitationVerifier.verify(issue, ARTIFACT, 'app.ts', { absencePatterns: compoundPatterns })
    expect(result.status).toBe('void')
    expect(result.isFabricated).toBe(true)
  })

  it('void when no positive anchor found', () => {
    const emptyArtifact = 'just some text without endpoints\n'
    const issue = makeTestIssue({
      evidence_file: 'readme.md',
      evidence_lines: [1],
      evidence_quote: 'no auth on the endpoint',
    })
    const result = CitationVerifier.verify(issue, emptyArtifact, 'readme.md', { absencePatterns: patterns })
    expect(result.status).toBe('void')
  })

  it('falls through to literal mode for non-absence quotes', () => {
    const issue = makeTestIssue({
      evidence_file: 'app.ts',
      evidence_lines: [1],
      evidence_quote: 'function login() {',
    })
    const result = CitationVerifier.verify(issue, ARTIFACT, 'app.ts', { absencePatterns: patterns })
    // The quote "function login() {" literally exists (starts) at line 1
    expect(result.status).toBe('verified')
    expect(result.quality).toBe('strong')
  })
})

describe('CitationVerifier — pipeline integrity hash', () => {
  it('computes SHA-256 hash', () => {
    const hash = CitationVerifier.computeHash('hello')
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(hash.length).toBe(64)
  })

  it('passes when hashes match', () => {
    const content = 'artifact content'
    const hash = CitationVerifier.computeHash(content)
    expect(CitationVerifier.checkIntegrity(hash, hash)).toBe(true)
  })

  it('fails when hashes mismatch', () => {
    const hash1 = CitationVerifier.computeHash('content v1')
    const hash2 = CitationVerifier.computeHash('content v2')
    expect(CitationVerifier.checkIntegrity(hash1, hash2)).toBe(false)
  })
})

describe('CitationVerifier — verifyIssues batch', () => {
  it('annotates issues and collects fabricated evidence', () => {
    const issues: SealIssue[] = [
      makeTestIssue({
        evidence_file: 'app.ts',
        evidence_lines: [1],
        evidence_quote: 'function login() {',
      }),
      makeTestIssue({
        evidence_file: 'app.ts',
        evidence_lines: [99],
        evidence_quote: 'ghost line',
      }),
      makeTestIssue({}),  // no evidence
    ]

    const result = CitationVerifier.verifyIssues(issues, ARTIFACT, 'app.ts')

    // Check annotations
    expect(result.issues[0].citation_status).toBe('verified')
    expect(result.issues[1].citation_status).toBe('phantom')
    expect(result.issues[2].citation_status).toBe('not_applicable')

    // Check fabricated evidence collection
    expect(result.fabricated.length).toBe(1)
    expect(result.fabricated[0].citation_status).toBe('phantom')
    expect(result.fabricated[0].fabricated_reason).toBe('location_not_found')
  })

  // Kernel/tactics separation (openspec/changes/verifiable-gate-hardening/design.md AD-3):
  // a finding whose citation is proven fabricated must not keep its original scoring/blocking
  // power — the claim was never verified as true, so it can't count as if it were.
  it('zeroes trust_deduction and forces is_blocking false when citation is proven fabricated (phantom)', () => {
    const issue = makeTestIssue({
      severity: 'HIGH',       // makeIssue sets is_blocking=true for HIGH
      trust_deduction: 25,
      evidence_file: 'app.ts',
      evidence_lines: [99],   // nonexistent line -> phantom
      evidence_quote: 'ghost line',
    })

    const result = CitationVerifier.verifyIssues([issue], ARTIFACT, 'app.ts')

    expect(result.issues[0].citation_status).toBe('phantom')
    expect(result.issues[0].trust_deduction).toBe(0)
    expect(result.issues[0].is_blocking).toBe(false)
  })

  it('zeroes trust_deduction and forces is_blocking false when citation is void (content mismatch)', () => {
    const issue = makeTestIssue({
      severity: 'CRITICAL',
      trust_deduction: 30,
      evidence_file: 'app.ts',
      evidence_lines: [1],
      evidence_quote: 'this text does not appear anywhere near line 1 at all',
    })

    const result = CitationVerifier.verifyIssues([issue], ARTIFACT, 'app.ts')

    expect(result.issues[0].citation_status).toBe('void')
    expect(result.issues[0].trust_deduction).toBe(0)
    expect(result.issues[0].is_blocking).toBe(false)
  })

  it('leaves trust_deduction and is_blocking untouched when citation verifies or is not applicable', () => {
    const issues: SealIssue[] = [
      makeTestIssue({
        severity: 'HIGH',
        trust_deduction: 10,
        evidence_file: 'app.ts',
        evidence_lines: [1],
        evidence_quote: 'function login() {',
      }),
      makeTestIssue({ severity: 'HIGH', trust_deduction: 10 }), // no evidence -> not_applicable
    ]

    const result = CitationVerifier.verifyIssues(issues, ARTIFACT, 'app.ts')

    expect(result.issues[0].citation_status).toBe('verified')
    expect(result.issues[0].trust_deduction).toBe(10)
    expect(result.issues[0].is_blocking).toBe(true)
    expect(result.issues[1].citation_status).toBe('not_applicable')
    expect(result.issues[1].trust_deduction).toBe(10)
    expect(result.issues[1].is_blocking).toBe(true)
  })
})
