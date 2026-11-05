import { describe, it, expect } from 'bun:test'
import { DEFAULT_FAILURE_PATTERN } from '../../src/spec/mutation-probe.ts'

describe('mutation-probe: DEFAULT_FAILURE_PATTERN', () => {
  // Lines captured from real piped `vitest run` and `bun test` failures.
  it('matches assertion diagnostics, not test names or source excerpts', () => {
    const diagnostics = ['AssertionError: expected 3 to be 4 // Object.is equality', 'error: expect(received).not.toBe(expected)', '    expect(received).toBe(expected)']
    const names = ['   × AssertionError in name 2ms', ' FAIL  v.test.ts > AssertionError in name', '(fail) expect(received) reports missing tool [0.4ms]', "      2| it('AssertionError in name', () => { expect(1 + 2).toBe(4) })", 'error: ENOENT: no such file or directory']
    expect(diagnostics.map(l => DEFAULT_FAILURE_PATTERN.test(l))).toEqual([true, true, true])
    expect(names.map(l => DEFAULT_FAILURE_PATTERN.test(l))).toEqual([false, false, false, false, false])
  })
})
