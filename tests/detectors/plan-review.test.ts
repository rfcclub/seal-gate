import { describe, it, expect } from 'bun:test'
import { ContradictionDetector } from '../../src/detectors/contradiction-detector.ts'
import { CriteriaCoverageDetector } from '../../src/detectors/criteria-coverage-detector.ts'
import { OrphanClaimDetector } from '../../src/detectors/orphan-claim-detector.ts'
import { gradeEvidence } from '../../src/types.ts'
import { ClaimExtractor } from '../../src/detectors/claim-extractor.ts'
import type { SealIssue } from '../../src/types.ts'

// ─── gradeEvidence ────────────────────────────────────────────────────────────

describe('gradeEvidence', () => {
  it('grades strong: Type G (contradiction pair — file + 2 lines + quote)', () => {
    const issue: SealIssue = {
      type: 'LOGIC_BUG', severity: 'HIGH', is_blocking: true, layer: 'L1', source: 'core',
      evidence: 'conflict',
      evidence_file: 'intent.md',
      evidence_lines: [120, 88],
      evidence_quote: '§Scope writes graph.json || §Constraints append-only',
    }
    expect(gradeEvidence(issue)).toBe('strong')
  })

  it('grades strong: Type H (criterion_ref + file + lines)', () => {
    const issue: SealIssue = {
      type: 'SPEC_MISMATCH', severity: 'MEDIUM', is_blocking: false, layer: 'L1', source: 'core',
      evidence: 'uncovered',
      evidence_file: 'self-check.md',
      evidence_lines: [14],
      criterion_ref: 'AC-3',
    }
    expect(gradeEvidence(issue)).toBe('strong')
  })

  it('grades strong: Type A+B (file + lines)', () => {
    const issue: SealIssue = {
      type: 'SPEC_MISMATCH', severity: 'MEDIUM', is_blocking: false, layer: 'L1', source: 'core',
      evidence: 'mismatch',
      evidence_file: 'design.md',
      evidence_lines: [42],
    }
    expect(gradeEvidence(issue)).toBe('strong')
  })

  it('grades strong: Type D (quote contains SHALL)', () => {
    const issue: SealIssue = {
      type: 'SPEC_MISMATCH', severity: 'MEDIUM', is_blocking: false, layer: 'L1', source: 'core',
      evidence: 'mismatch',
      evidence_quote: 'AC-1 SHALL degrade gracefully',
    }
    expect(gradeEvidence(issue)).toBe('strong')
  })

  it('grades weak: AMBIGUITY type (Type F)', () => {
    const issue: SealIssue = {
      type: 'AMBIGUITY', severity: 'LOW', is_blocking: false, layer: 'L1', source: 'core',
      evidence: 'assumption marker',
    }
    expect(gradeEvidence(issue)).toBe('weak')
  })

  it('grades none: all empty', () => {
    const issue: SealIssue = {
      type: 'OTHER', severity: 'LOW', is_blocking: false, layer: 'L1', source: 'core',
      evidence: 'nothing',
    }
    expect(gradeEvidence(issue)).toBe('none')
  })
})

// ─── ContradictionDetector ───────────────────────────────────────────────────

const CONTRADICTING_ARTIFACT = `## Scope
Step 4 writes graph.json to disk.

## Constraints
graph.json is append-only via mutex this phase. No direct writes allowed.
`

const CLEAN_ARTIFACT = `## Scope
Step 4 reads config.json and processes it.

## Constraints
Output log is append-only.
`

const NON_GOAL_ARTIFACT = `## Non-Goals
We will not add user authentication in this phase.

## Spec
This feature shall add user authentication via OAuth.
`

describe('ContradictionDetector', () => {
  it('detects write vs readonly contradiction', () => {
    const result = ContradictionDetector.detect({ artifact: CONTRADICTING_ARTIFACT, artifact_file: 'intent.md' })
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0].type).toBe('LOGIC_BUG')
    expect(result.issues[0].required_verdict).toBe('BLOCK')
  })

  it('grades contradiction issues as strong (Type G — two lines)', () => {
    const result = ContradictionDetector.detect({ artifact: CONTRADICTING_ARTIFACT, artifact_file: 'intent.md' })
    const issue = result.issues[0]
    expect(issue.evidence_lines?.length).toBeGreaterThanOrEqual(2)
    expect(gradeEvidence(issue)).toBe('strong')
  })

  it('returns no issues for clean artifact', () => {
    const result = ContradictionDetector.detect({ artifact: CLEAN_ARTIFACT })
    expect(result.issues).toHaveLength(0)
  })

  it('detects non-goal violations', () => {
    const result = ContradictionDetector.detect({ artifact: NON_GOAL_ARTIFACT })
    const ngIssue = result.issues.find(i => i.evidence.includes('Non-goal'))
    expect(ngIssue).toBeDefined()
    expect(ngIssue?.type).toBe('LOGIC_BUG')
  })

  it('includes policy_tags: consistency', () => {
    const result = ContradictionDetector.detect({ artifact: CONTRADICTING_ARTIFACT })
    expect(result.issues[0].policy_tags).toContain('consistency')
  })
})

// ─── CriteriaCoverageDetector ────────────────────────────────────────────────

const lockedCriteria = [
  { id: 'AC-1', text: 'SHALL degrade gracefully if Worker unavailable', source_file: 'self-check.md', source_line: 14 },
  { id: 'AC-2', text: 'SHALL log all errors to structured output', source_file: 'intent.md', source_line: 20 },
]

const coveringArtifact = `
## Worker Unavailable Path
If the Worker is unavailable, the system degrades gracefully by falling back to cache.
This section covers the AC-1 requirement.

## Error Logging
All errors SHALL log to structured output via the logging pipeline. This satisfies AC-2.
`

const nonCoveringArtifact = `
## Happy Path
Everything works fine when all systems are operational.
`

describe('CriteriaCoverageDetector', () => {
  it('emits ESCALATE when no locked criteria', () => {
    const result = CriteriaCoverageDetector.detect({ artifact: 'some artifact', locked_criteria: [] })
    expect(result.no_criteria_escalate).toBe(true)
    expect(result.issues[0].required_verdict).toBe('ESCALATE_TO_HUMAN')
    expect(result.issues[0].type).toBe('AMBIGUITY')
  })

  it('emits no issues when all criteria are covered', () => {
    const result = CriteriaCoverageDetector.detect({
      artifact: coveringArtifact,
      locked_criteria: lockedCriteria,
    })
    expect(result.issues).toHaveLength(0)
    expect(result.confirmed_strong_fields).toBe(2)
  })

  it('emits SPEC_MISMATCH for uncovered criterion with criterion_ref', () => {
    const result = CriteriaCoverageDetector.detect({
      artifact: nonCoveringArtifact,
      locked_criteria: lockedCriteria,
    })
    const uncoveredIssue = result.issues.find(i => i.criterion_ref === 'AC-1')
    expect(uncoveredIssue).toBeDefined()
    expect(uncoveredIssue?.type).toBe('SPEC_MISMATCH')
    expect(uncoveredIssue?.required_verdict).toBe('REVISE')
    expect(gradeEvidence(uncoveredIssue!)).toBe('strong') // Type H
  })

  it('increments confirmed_strong_fields for each covered AC', () => {
    const result = CriteriaCoverageDetector.detect({
      artifact: coveringArtifact,
      locked_criteria: lockedCriteria,
    })
    expect(result.confirmed_strong_fields).toBe(2)
  })
})

// ─── OrphanClaimDetector ─────────────────────────────────────────────────────

describe('OrphanClaimDetector', () => {
  it('detects orphan claims without anchors', () => {
    const artifact = 'All tests pass. The implementation is fully complete.'
    const claims = ClaimExtractor.extract(artifact)
    const result = OrphanClaimDetector.detect(claims, artifact)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0].type).toBe('MISSING_EVIDENCE')
  })

  it('skips claims with REQ anchor', () => {
    const artifact = 'All tests pass. REQ-3 requires this. The implementation is fully complete per REQ-3.'
    const claims = ClaimExtractor.extract(artifact)
    const result = OrphanClaimDetector.detect(claims, artifact)
    // Should have fewer issues than without anchor
    const artifactNoAnchor = 'All tests pass. The implementation is fully complete.'
    const claimsNoAnchor = ClaimExtractor.extract(artifactNoAnchor)
    const resultNoAnchor = OrphanClaimDetector.detect(claimsNoAnchor, artifactNoAnchor)
    expect(result.issues.length).toBeLessThanOrEqual(resultNoAnchor.issues.length)
  })

  it('issues are non-blocking', () => {
    const artifact = 'All tests pass. The system is fully complete.'
    const claims = ClaimExtractor.extract(artifact)
    const result = OrphanClaimDetector.detect(claims, artifact)
    expect(result.issues.every(i => !i.is_blocking)).toBe(true)
  })

  it('empty artifact yields no orphan issues', () => {
    const result = OrphanClaimDetector.detect([], '')
    expect(result.issues).toHaveLength(0)
  })
})
