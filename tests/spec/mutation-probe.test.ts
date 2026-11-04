import { describe, it, expect } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
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

    const original = 'expect(add(1, 2)).toBe(3) // guard'
    const killRunner = async () => readFileSync(testFile, 'utf-8') === original ? { exit_code: 0, output: 'pass' } : { exit_code: 1, output: 'AssertionError: expected 3 not to be 3' }
    const res = await checkTestPinsBehavior({
      test_file: testFile,
      run_command: ['bun', ['test', testFile]],
      workdir: dir,
      _runTest: killRunner,
    })
    expect(res).toEqual({ pinned: true, survivors: [] })
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

    // Passes the unmutated test (the probe's baseline) and fails every mutation.
    const killRunner = async () => readFileSync(testFile, 'utf-8') === testLog ? { exit_code: 0, output: 'pass' } : { exit_code: 1, output: 'AssertionError: expected undefined to be defined' }
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
describe('mutation-probe: inconclusive outcomes', () => {
  const ORIGINAL = 'expect(add(1, 2)).toBe(3) // guard'
  const probeFile = () => {
    const dir = mkdtempSync(join(tmpdir(), 'seal-mut-inconclusive-'))
    const testFile = join(dir, 'demo.test.ts')
    writeFileSync(testFile, ORIGINAL, 'utf-8')
    return { dir, testFile }
  }
  // Passes the unmutated source and fails every mutation, counting runs of each.
  const discriminating = (testFile: string, onMutation: () => { exit_code: number; output: string; error?: string } = () => ({ exit_code: 1, output: 'AssertionError: expected 3 to be 4' })) => {
    const runs = { baseline: 0, mutation: 0 }
    const runTest = async () => {
      if (readFileSync(testFile, 'utf-8') === ORIGINAL) { runs.baseline++; return { exit_code: 0, output: 'pass' } }
      runs.mutation++
      return onMutation()
    }
    return { runs, runTest }
  }

  it('runner-missing: a runner that cannot start is not a pin', async () => {
    const { dir, testFile } = probeFile()
    const res = await checkTestPinsBehavior({ test_file: testFile, run_command: ['/definitely/nonexistent/seal-test-runner', []], workdir: dir })
    expect(res).toMatchObject({ skipped: true })
    expect('pinned' in res).toBe(false)
  })

  it('runner-timeout: a runner past its timeout is not a pin', async () => {
    const { dir, testFile } = probeFile()
    const res = await checkTestPinsBehavior({ test_file: testFile, run_command: ['sh', ['-c', 'sleep 1']], workdir: dir, timeout_ms: 200 })
    expect(res).toMatchObject({ skipped: true })
    expect('skipped' in res && res.reason).toContain('runner')
  }, 10_000)

  it('mutation-runner-error: a runner error during a mutation is not a kill', async () => {
    const { dir, testFile } = probeFile()
    const { runTest } = discriminating(testFile, () => ({ exit_code: 1, output: '', error: 'spawn EACCES' }))
    const res = await checkTestPinsBehavior({ test_file: testFile, run_command: ['bun', ['test', testFile]], workdir: dir, _runTest: runTest })
    expect(res).toMatchObject({ skipped: true })
    expect(readFileSync(testFile, 'utf-8')).toBe(ORIGINAL)
  })

  it('baseline-failing: a test that fails unmutated pins nothing', async () => {
    const { dir, testFile } = probeFile()
    const res = await checkTestPinsBehavior({ test_file: testFile, run_command: ['bun', ['test', testFile]], workdir: dir, _runTest: async () => ({ exit_code: 1, output: 'fail' }) })
    expect(res).toMatchObject({ skipped: true })
    expect('skipped' in res && res.reason).toContain('baseline')
  })

  it('mutation-tool-failure: a required tool that fails after a passing baseline is not a kill', async () => {
    const { dir, testFile } = probeFile()
    // A real runner: passes the unmutated file, then needs a child tool that does not exist.
    const runner = join(dir, 'runner.mjs')
    writeFileSync(runner, `import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
if (readFileSync(${JSON.stringify(testFile)}, 'utf8') === ${JSON.stringify(ORIGINAL)}) process.exit(0)
const child = spawnSync('/definitely/nonexistent/seal-child')
console.error(String(child.error))
process.exit(127)
`)
    const res = await checkTestPinsBehavior({ test_file: testFile, run_command: [process.execPath, [runner]], workdir: dir })
    expect(res).toMatchObject({ skipped: true })
    expect(readFileSync(testFile, 'utf-8')).toBe(ORIGINAL)
  })

  it('mutation-unproven-failure: exit 1 without assertion evidence is not a kill', async () => {
    const { dir, testFile } = probeFile()
    const { runTest } = discriminating(testFile, () => ({ exit_code: 1, output: 'Error: Cannot find module ./config' }))
    const res = await checkTestPinsBehavior({ test_file: testFile, run_command: ['bun', ['test', testFile]], workdir: dir, _runTest: runTest })
    expect(res).toMatchObject({ skipped: true })
  })

  it('real-bun-non-assertion: a bun (fail) without an assertion is not a kill', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seal-mut-real-'))
    const testFile = join(dir, 'tool.test.ts')
    // Mutating `true` to `false` makes the test throw ENOENT; bun reports it as "(fail)", with no assertion.
    writeFileSync(testFile, "import { test } from 'bun:test'\nimport { spawnSync } from 'node:child_process'\nconst gate = true\ntest('missing tool', () => { if (!gate) { const r = spawnSync('/definitely/nonexistent/child'); throw r.error } })\n")
    const res = await checkTestPinsBehavior({ test_file: testFile, run_command: [process.argv0.includes('bun') ? process.execPath : 'bun', ['test', testFile]], workdir: dir })
    expect(res).toMatchObject({ skipped: true })
  }, 30_000)

  it('real-runner-pin: a real bun test assertion failure pins', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seal-mut-real-'))
    const testFile = join(dir, 'real.test.ts')
    writeFileSync(testFile, "import { test, expect } from 'bun:test'\ntest('adds', () => { expect(1 + 2).toBe(3) })\n")
    const res = await checkTestPinsBehavior({ test_file: testFile, run_command: [process.argv0.includes('bun') ? process.execPath : 'bun', ['test', testFile]], workdir: dir })
    expect(res).toEqual({ pinned: true, survivors: [] })
  }, 30_000)

  it('baseline-then-kills: a passing baseline with killed mutations pins', async () => {
    const { dir, testFile } = probeFile()
    const { runs, runTest } = discriminating(testFile)
    const res = await checkTestPinsBehavior({ test_file: testFile, run_command: ['bun', ['test', testFile]], workdir: dir, _runTest: runTest })
    expect(res).toEqual({ pinned: true, survivors: [] })
    expect(runs.baseline).toBe(1)
    expect(runs.mutation).toBeGreaterThan(0)
  })
})
