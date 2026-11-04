import { existsSync, readFileSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * test_exercises() Level 2b — mutation probe.
 *
 * A test that still passes after a single-point mutation of its own source does not
 * actually pin the behavior it claims to cover. We breed each mutation in isolation,
 * rerun the test, and if any mutation survives (test still green) we report the test as
 * unpinned → SPEC_UNTESTED during spec coverage.
 *
 * This is the "mutation-survives => test does not pin behavior" rule from the debug/harness
 * design. It is deliberately static, single-point, and fast (≤ a handful per task).
 */

export type MutationResult =
  | { pinned: true; survivors: string[] }
  | { pinned: false; survivors: string[] }

export type MutationProbeOutcome =
  | MutationResult
  | { skipped: true; reason: string }

export interface MutationProbeOpts {
  /** absolute path to the test source file to probe */
  test_file: string
  /** command + args that run just this one test, e.g. ['bun', ['test', 'tests/x.test.ts']] */
  run_command: [string, string[]]
  /** cwd for the command */
  workdir: string
  /** optional: stop after this many surviving mutations (0 = report all) */
  cap?: number
  /** optional: per-run timeout for the default runner (default 60s) */
  timeout_ms?: number
  /** optional: output that proves a failing run was an assertion failure (default: DEFAULT_FAILURE_PATTERN) */
  failure_pattern?: RegExp
  /** override exec for tests (inject a fake runTest); `error` marks a runner failure, not a test failure */
  _runTest?: (workdir: string, cmd: string, args: string[]) => Promise<RunResult>
}

interface RunResult { exit_code: number; output: string; error?: string }

/**
 * Assertion-failure output of node:assert and Vitest (AssertionError) and of Bun and Jest
 * (expect(received)). A runner's generic per-test failure line, such as Bun's "(fail) ", is
 * printed for any thrown error and is not evidence.
 */
export const DEFAULT_FAILURE_PATTERN = /AssertionError|expect\(received\)/

/** Single-point mutation operators. Each returns a list of mutated sources. */
export function breedMutations(source: string): string[] {
  const mutations: string[] = []

  // 1. expect(a).toBe(b)  ⇄  expect(a).not.toBe(b)
  //    plus other toXxx assertions flipped to their negation.
  const assertFlip = source.replace(
    /expect\(((?:[^()]|\([^()]*\))*)\)\.(to(?:Be|Equal|Match|Contain|BeDefined|BeTruthy|BeFalsy))\(([^)]*)\)/g,
    (_m, expr, method, arg) => `expect(${expr}).not.${method}(${arg})`,
  )
  if (assertFlip !== source) mutations.push(assertFlip)

  // 2. ===  ⇄  !==
  const notEquals = source.replace(/([^\s!<>])\s*===\s*([^\s,;()]+)/g, '$1 !== $2')
  if (notEquals !== source) mutations.push(notEquals)
  const equals = source.replace(/([^\s!<>])\s*!==\s*([^\s,;()]+)/g, '$1 === $2')
  if (equals !== source) mutations.push(equals)

  // 3. boolean literal true ⇄ false
  const trueToFalse = source.replace(/\btrue\b/g, 'false')
  if (trueToFalse !== source) mutations.push(trueToFalse)
  const falseToTrue = source.replace(/\bfalse\b/g, 'true')
  if (falseToTrue !== source) mutations.push(falseToTrue)

  // 4. numeric literal +1 (first integer ≥ 0, excluding 0 and 1 to avoid trivial)
  const numMatch = source.match(/\b([2-9]|\d{2,})\b/)
  if (numMatch) {
    const n = parseInt(numMatch[1], 10)
    mutations.push(source.replace(numMatch[1], String(n + 1)))
  }

  // 5. relational operator >  ⇄  <=  ; <  ⇄  >=
  const ltReverse = source.replace(/([^\s!<>])\s*<\s*=\s*([^\s,;()]+)/g, '$1 > $2')
  if (ltReverse !== source) mutations.push(ltReverse)
  const gtToLt = source.replace(/([^\s!<>])\s*>\s*([^\s,;()]+)/g, '$1 < $2')
  if (gtToLt !== source) mutations.push(gtToLt)

  // de-dup
  return [...new Set(mutations)]
}

async function defaultRunTest(
  workdir: string,
  cmd: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: workdir, timeout: timeoutMs })
    return { exit_code: 0, output: `${stdout}\n${stderr}` }
  } catch (e) {
    const err = e as { code?: number | string; killed?: boolean; signal?: string | null; stdout?: string; stderr?: string; message?: string }
    const output = `${err.stdout ?? ''}\n${err.stderr ?? ''}`
    // A numeric exit code is the test failing — a "killed" mutation. A string code (ENOENT),
    // a kill (how a timeout ends) or no code means the runner itself failed.
    if (typeof err.code === 'number' && !err.killed && !err.signal) return { exit_code: err.code, output }
    return { exit_code: 1, output, error: err.killed || err.signal ? `runner timed out or was killed (${err.signal ?? 'killed'})` : `runner failed: ${err.message ?? err.code}` }
  }
}

/**
 * Probe whether the test truly pins behavior. Unpinned (any surviving mutation) ⇒ a
 * candidate for SPEC_UNTESTED during spec coverage.
 *
 * Approach: temporarily swap the on-disk test source with each mutation, run the test
 * command (which points at the REAL test path so relative imports stay valid), then
 * restore the original in `finally`. On any error the restore still runs — we never leave
 * a mutated file behind.
 */
export async function checkTestPinsBehavior(opts: MutationProbeOpts): Promise<MutationProbeOutcome> {
  const { test_file, run_command, workdir, cap, _runTest } = opts

  if (!test_file || !existsSync(test_file)) {
    return { skipped: true, reason: `test file does not exist: ${test_file}` }
  }
  if (!run_command || run_command.length !== 2 || !run_command[0]) {
    return { skipped: true, reason: 'no run_command provided' }
  }
  if (!existsSync(workdir)) {
    return { skipped: true, reason: `workdir does not exist: ${workdir}` }
  }

  const runTest = _runTest ?? ((dir: string, c: string, a: string[]) => defaultRunTest(dir, c, a, opts.timeout_ms))
  const original = readFileSync(test_file, 'utf-8')
  const mutations = breedMutations(original)

  if (mutations.length === 0) {
    return { skipped: true, reason: 'no mutation operators applied to this test source' }
  }

  const [cmd, args] = run_command
  // A kill only means something if the unmutated test runs and passes.
  const baseline = await runTest(workdir, cmd, args)
  if (baseline.error) return { skipped: true, reason: `inconclusive: baseline ${baseline.error}` }
  if (baseline.exit_code !== 0) {
    return { skipped: true, reason: `inconclusive: baseline test fails unmutated (exit ${baseline.exit_code})` }
  }

  const survivors: string[] = []
  const unproven: string[] = []
  let kills = 0

  for (const mutated of mutations) {
    writeFileSync(test_file, mutated, 'utf-8') // swap in the mutation
    let probe: RunResult
    try {
      probe = await runTest(workdir, cmd, args)
    } finally {
      writeFileSync(test_file, original, 'utf-8') // always restore, even on throw
    }
    if (probe.error) return { skipped: true, reason: `inconclusive: mutation run ${probe.error}` }
    if (probe.exit_code === 0) {
      survivors.push(mutated)
      if (cap && survivors.length >= cap) break
      continue
    }
    // A failing run is a kill only if it looks like a failed assertion. A missing tool, a crash
    // or a mutation that breaks the syntax also exits nonzero; such runs are not counted.
    if (probe.exit_code === 1 && (opts.failure_pattern ?? DEFAULT_FAILURE_PATTERN).test(probe.output)) kills++
    else unproven.push(`exit ${probe.exit_code}`)
  }

  if (survivors.length > 0) return { pinned: false, survivors }
  if (kills === 0) {
    return { skipped: true, reason: `inconclusive: no mutation run failed with assertion-failure evidence (${unproven.join(', ')})` }
  }
  return { pinned: true, survivors: [] }
}

/** Format surviving mutations as an evidence snippet for SPEC_UNTESTED. */
export function mutationSurvivorEvidence(survivors: string[]): string {
  if (survivors.length === 0) return ''
  const first = survivors[0].trim()
  // collapse whitespace for compact evidence
  const compact = first.replace(/\s+/g, ' ').slice(0, 160)
  return `mutation survived (test still passed after flipping an assertion): ${compact}`
}