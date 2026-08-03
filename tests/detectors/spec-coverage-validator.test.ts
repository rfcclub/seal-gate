import { describe, it, expect } from 'bun:test'
import { SpecCoverageValidator } from '../../src/detectors/spec-coverage-validator.ts'

const TEST_SPEC = `## Requirements

### Requirement: Login endpoint (SHALL)
- The system SHALL validate user credentials
- The system SHALL return a JWT token on success
- The system SHALL reject invalid passwords with 401

#### Scenario: Valid login
- WHEN a user provides correct credentials
- THEN a JWT token is returned

### Requirement: Rate limiting (SHOULD)
- The system SHOULD rate-limit login attempts
`

describe('SpecCoverageValidator', () => {
  it('detects covered criteria via test name match', () => {
    const testLog = `
describe('Login endpoint', () => {
  it('validates user credentials', () => {
    expect(validateCredentials('user', 'pass')).toBe(true)
  })
  it('returns JWT token on success', () => {
    const token = login('user', 'correct_pass')
    expect(token).toBeDefined()
  })
  it('rejects invalid passwords with 401', () => {
    const response = login('user', 'wrong')
    expect(response.status).toBe(401)
  })
})
`
    const result = SpecCoverageValidator.validate(TEST_SPEC, testLog, '')

    // Should have parsed criteria and found coverage
    expect(result.coverage.length).toBeGreaterThanOrEqual(3)

    // Find specific criteria
    const credentials = result.coverage.find(c => c.criterion.includes('validate user credentials'))
    expect(credentials).toBeDefined()
    expect(credentials!.level).toBe(1)

    const jwt = result.coverage.find(c => c.criterion.includes('JWT token'))
    expect(jwt).toBeDefined()
    expect(jwt!.level).toBe(1)

    const rejectInvalid = result.coverage.find(c => c.criterion.includes('reject invalid passwords'))
    expect(rejectInvalid).toBeDefined()
    expect(rejectInvalid!.level).toBe(1)
  })

  it('flags uncovered criteria with SPEC_MISMATCH issues', () => {
    const testLog = ''  // no test log at all
    const result = SpecCoverageValidator.validate(TEST_SPEC, testLog, '')

    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues.every(i => i.type === 'SPEC_MISMATCH')).toBe(true)
    expect(result.issues.every(i => i.severity === 'MEDIUM')).toBe(true)

    // All criteria should be level 0 (uncovered)
    result.coverage.forEach(c => {
      expect(c.level).toBe(0)
    })
  })

  it('returns empty results when no spec is provided', () => {
    const result = SpecCoverageValidator.validate(null, 'test log content', '')
    expect(result.issues.length).toBe(0)
    expect(result.assumptions.length).toBe(1)
    expect(result.assumptions[0]).toContain('No spec provided')
    expect(result.coverage.length).toBe(0)
  })

  it('returns empty results for empty spec', () => {
    const result = SpecCoverageValidator.validate('', 'test log content', '')
    expect(result.issues.length).toBe(0)
    expect(result.coverage.length).toBe(0)
  })

  it('detects coverage via AC-ID references', () => {
    const specWithIds = `## Requirements
- AC-001: User can log in with valid credentials
- AC-002: Rate limiting works after 5 attempts
`
    const testLog = `
  it('tests AC-001 login flow', () => {
    expect(login('user', 'pass')).toBeDefined()
  })
  it('verifies AC-002 rate limiting', () => {
    // covers rate limiting requirement
  })
`
    const result = SpecCoverageValidator.validate(specWithIds, testLog, '')
    expect(result.coverage.length).toBe(2)
    result.coverage.forEach(c => {
      expect(c.level).toBe(1)
      expect(c.match_type).toBe('test_name')
    })
  })

  it('covers via assertion pattern match', () => {
    const spec = `## Requirements
- Token must be a valid JWT
`
    const testLog = `
  it('generates token', () => {
    const token = generateToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/)
  })
`
    const result = SpecCoverageValidator.validate(spec, testLog, '')
    const tokenCriterion = result.coverage.find(c => c.criterion.includes('valid JWT'))
    expect(tokenCriterion).toBeDefined()
    expect(tokenCriterion!.level).toBe(1)
  })
})
