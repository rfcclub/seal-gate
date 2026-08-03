import { describe, it, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { breedMutations, checkTestPinsBehavior, mutationSurvivorEvidence } from '../../src/spec/mutation-probe.ts'
import { SpecCoverageValidator } from '../../src/detectors/spec-coverage-validator.ts'

/** Fake runner: mutation-survives iff the mutated source does NOT reference a sentinel. */
function fakeRunner(mutatedOverride?: (source: string) => number) {
  return async (_workdir: string, _cmd: string, _args: string[]): Promise<{ exit_code: number; output: string }> => {
    return { exit_code: 0, output: 'fake pass' }
  }
}

describe('mutation-probe: breedMutations', () => {
  it('flips expect().toBe(x) to .not.toBe(x)', () => {
    const src = "expect(add(1, 2)).toBe(3)"
    const muts = breedMutations(src)
    expect(muts.some(m => m.includes('.not.toBe(3)'))).toBe(true)
  })

  it('flips === to !==', () => {
    const src = 'if (a === b) return'
    const muts = breedMutations(src)
    expect(muts.some(m => m.includes('a !== b'))).toBe(true)
  })

  it('flips boolean literal true to false', () => {
    const src = 'const ok = true'
    const muts = breedMutations(src)
    expect(muts.some(m => m.includes('false'))).toBe(true)
  })

  it('bumps a numeric literal', () => {
    const src = 'expect(x).toBe(5)'
    const muts = breedMutations(src)
    expect(muts.some(m => m.includes('toBe(6)'))).toBe(true)
  })

  it('dedupes mutations', () => {
    const src = 'expect(a).toBe(b)'
    const muts = breedMutations(src)
    expect(new Set(muts).size).toBe(muts.length)
  })
})

describe('mutation-probe: checkTestPinsBehavior', () => {
  it('skips when run_command is missing (never throws)', async () => {
    const res = await checkTestPinsBehavior({
      test_file: '/nonexistent/not-there.ts',
      run_command: ['', []],
      workdir: '/tmp',
    })
    expect('skipped' in res && res.skipped).toBe(true)
  })

  it('skips when test file does not exist', async () => {
    const res = await checkTestPinsBehavior({
      test_file: '/definitely/missing.ts',
      run_command: ['bun', ['test']],
      workdir: '/tmp',
    })
    expect('skipped' in res && res.skipped).toBe(true)
  })

  it('reports pinned:false when a mutation survives (fake runner always passes)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seal-mut-test-'))
    const testFile = join(dir, 'demo.test.ts')
    writeFileSync(testFile, 'expect(add(1, 2)).toBe(3)', 'utf-8')

    const res = await checkTestPinsBehavior({
      test_file: testFile,
      run_command: ['bun', ['test', testFile]],
      workdir: dir,
      _runTest: fakeRunner(), // fake always exit 0 => movements survive
    })

    expect('skipped' in res && res.skipped).toBe(false)
    if ('pinned' in res) {
      expect(res.pinned).toBe(false)
      expect(res.survivors.length).toBeGreaterThan(0)
    }
  })

  it('reports pinned:true when every mutation kills the test (fake runner fails on mutation)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seal-mut-test-'))
    const testFile = join(dir, 'demo.test.ts')
    writeFileSync(testFile, 'expect(add(1, 2)).toBe(3) // guard', 'utf-8')

    const killRunner = async () => ({ exit_code: 1, output: 'fail' })
    const res = await checkTestPinsBehavior({
      test_file: testFile,
      run_command: ['bun', ['test', testFile]],
      workdir: dir,
      _runTest: killRunner,
    })
    if ('pinned' in res) {
      expect(res.pinned).toBe(true)
      expect(res.survivors).toEqual([])
    }
  })
})

describe('mutation-probe: mutationSurvivorEvidence', () => {
  it('formats a compact evidence snippet', () => {
    const evid = mutationSurvivorEvidence(['expect(add(1, 2)).not.toBe(3)  // a long comment here that pads things out beyond the 160 char cap so it gets collapsed and sliced'])
    expect(evid).toContain('mutation survived')
    expect(evid.length).toBeLessThanOrEqual(200)
  })
})

describe('SpecCoverageValidator.validateWithProbe', () => {
  it('downgrades an unpinned (vacuous) test to SPEC_UNTESTED', async () => {
    const spec = `## Requirements
- Checkout must apply promo discount
`
    const testLog = `describe('Checkout', () => { it('applies promo discount', () => {
  expect(applyPromo(100, 'PROMO')).toBe(70)
}) })`

    const dir = mkdtempSync(join(tmpdir(), 'seal-vw-'))
    const testFile = join(dir, 'checkout.test.ts')
    writeFileSync(testFile, testLog.replace(/\n\s*/g, '\n  '), 'utf-8')

    // Survivors present -> probe says unpinned
    const result = await SpecCoverageValidator.validateWithProbe(
      spec,
      testLog,
      '',
      [{ criterion: 'Checkout must apply promo discount', test_file: testFile, run_command: ['bun', ['test', testFile]], workdir: dir, _runTest: fakeRunner() as any }],
    )

    // Should NOT crash; with survivors present the criterion is downgraded and a SPEC_UNTESTED is raised
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues.some(i => i.type === 'SPEC_UNTESTED')).toBe(true)
  })

  it('leaves a pinned test as level 1 with no SPEC_UNTESTED', async () => {
    const spec = `## Requirements
- Auth returns JWT
`
    const testLog = `it('returns JWT on success', () => {
  const t = login('u','p'); expect(t.jwt).toBeDefined()
})`
    const dir = mkdtempSync(join(tmpdir(), 'seal-vw2-'))
    const testFile = join(dir, 'auth.test.ts')
    writeFileSync(testFile, testLog, 'utf-8')

    const killRunner = async () => ({ exit_code: 1, output: 'fail' })
    const result = await SpecCoverageValidator.validateWithProbe(
      spec,
      testLog,
      '',
      [{ criterion: 'Auth returns JWT', test_file: testFile, run_command: ['bun', ['test', testFile]], workdir: dir, _runTest: killRunner }],
    )

    const criterion = result.coverage.find(c => c.criterion.includes('Auth returns JWT'))
    expect(criterion).toBeDefined()
    expect(criterion!.pinned).toBe(true)
    expect(result.issues.some(i => i.type === 'SPEC_UNTESTED')).toBe(false)
  })
})