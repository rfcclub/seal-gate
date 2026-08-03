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
  /** override exec for tests (inject a fake runTest) */
  _runTest?: (workdir: string, cmd: string, args: string[]) => Promise<{ exit_code: number; output: string }>
}

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
): Promise<{ exit_code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: workdir, timeout: 60_000 })
    return { exit_code: 0, output: `${stdout}\n${stderr}` }
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string; message?: string }
    // execFile treats non-zero exit as an error — that's a "killed" mutation.
    return { exit_code: err.code ?? 1, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` }
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

  const runTest = _runTest ?? defaultRunTest
  const original = readFileSync(test_file, 'utf-8')
  const mutations = breedMutations(original)

  if (mutations.length === 0) {
    return { skipped: true, reason: 'no mutation operators applied to this test source' }
  }

  const [cmd, args] = run_command
  const survivors: string[] = []

  for (const mutated of mutations) {
    writeFileSync(test_file, mutated, 'utf-8') // swap in the mutation
    let probe: { exit_code: number; output: string }
    try {
      probe = await runTest(workdir, cmd, args)
    } finally {
      writeFileSync(test_file, original, 'utf-8') // always restore, even on throw
    }
    if (probe.exit_code === 0) {
      survivors.push(mutated)
      if (cap && survivors.length >= cap) break
    }
  }

  return survivors.length > 0
    ? { pinned: false, survivors }
    : { pinned: true, survivors: [] }
}

/** Format surviving mutations as an evidence snippet for SPEC_UNTESTED. */
export function mutationSurvivorEvidence(survivors: string[]): string {
  if (survivors.length === 0) return ''
  const first = survivors[0].trim()
  // collapse whitespace for compact evidence
  const compact = first.replace(/\s+/g, ' ').slice(0, 160)
  return `mutation survived (test still passed after flipping an assertion): ${compact}`
}