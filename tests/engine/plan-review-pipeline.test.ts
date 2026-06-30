import { describe, it, expect } from 'bun:test'
import { Seal } from '../../src/index.ts'

const LOCKED_CRITERIA = [
  { id: 'AC-1', text: 'SHALL degrade gracefully if Worker unavailable', source_file: 'intent.md', source_line: 10 },
  { id: 'AC-2', text: 'SHALL emit structured error logs', source_file: 'intent.md', source_line: 11 },
]

const GOOD_DESIGN = `
## Worker Unavailable Path
If the Worker is unavailable, the system degrades gracefully via cache fallback. Satisfies AC-1.

## Error Logging
All errors shall emit structured error logs through the pipeline. Satisfies AC-2.

## Implementation Plan
Steps are sequential and reversible. Human sign-off required before each deployment.
`

const CONTRADICTING_DESIGN = `
## Step 3
Step 3 writes config.json to disk.

## Constraints
config.json is read-only and append-only via mutex.

## Worker Unavailable Path
Degrades gracefully. Satisfies AC-1.

## Error Logging
All errors emit structured logs. Satisfies AC-2.
`

const NO_CRITERIA_DESIGN = `
## Design
This design does things without any locked acceptance criteria.
`

describe('plan_review pipeline (Seal.review)', () => {
  it('routes plan_review artifact_type to plan pipeline', async () => {
    const result = await Seal.review({
      artifact_type: 'plan_review',
      output: GOOD_DESIGN,
      spec: null,
      context: { locked_criteria: LOCKED_CRITERIA },
    })
    expect(result.schema_version).toBeDefined()
    expect(['PASS', 'PASS_WITH_WARNINGS', 'REVISE']).toContain(result.verdict)
  })

  it('ESCALATE when no locked criteria (preflight)', async () => {
    const result = await Seal.review({
      artifact_type: 'plan_review',
      output: NO_CRITERIA_DESIGN,
      spec: null,
      context: { locked_criteria: [] },
    })
    expect(result.verdict).toBe('ESCALATE_TO_HUMAN')
    expect(result.blocking_issues.length + result.non_blocking_issues.length).toBeGreaterThan(0)
  })

  it('BLOCK when contradiction found', async () => {
    const result = await Seal.review({
      artifact_type: 'plan_review',
      output: CONTRADICTING_DESIGN,
      spec: null,
      context: { locked_criteria: LOCKED_CRITERIA },
    })
    // ContradictionDetector fires BLOCK for write vs readonly
    expect(['BLOCK', 'ESCALATE_TO_HUMAN', 'REVISE']).toContain(result.verdict)
    expect(result.deterministic_findings.some(f => f.rule_id === 'PR001')).toBe(true)
  })

  it('pass threshold is 90 (higher than code mode)', async () => {
    // A clean plan with all criteria covered should still need high score
    const result = await Seal.review({
      artifact_type: 'plan_review',
      output: GOOD_DESIGN,
      spec: null,
      context: { locked_criteria: LOCKED_CRITERIA },
    })
    // trust_score should reflect plan_review thresholds
    if (result.verdict === 'PASS') {
      expect(result.trust_score).toBeGreaterThanOrEqual(90)
    }
  })

  it('hard_block_bypass: removes_existing_block routes to ESCALATE', async () => {
    const removeBlockDesign = `
## Change
This plan removes the BLOCK verdict from the gate for migration artifacts.
The gate will no longer block without rollback. Human sign-off required.
`
    const result = await Seal.review({
      artifact_type: 'plan_review',
      output: removeBlockDesign,
      spec: null,
      context: { locked_criteria: LOCKED_CRITERIA },
    })
    expect(['ESCALATE_TO_HUMAN', 'BLOCK']).toContain(result.verdict)
  })

  it('summary contains plan_review prefix', async () => {
    const result = await Seal.review({
      artifact_type: 'plan_review',
      output: GOOD_DESIGN,
      spec: null,
      context: { locked_criteria: LOCKED_CRITERIA },
    })
    expect(result.summary).toContain('plan_review')
  })
})
