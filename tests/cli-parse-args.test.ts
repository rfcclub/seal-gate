import { describe, it, expect } from 'bun:test'
import { parseArgs } from '../src/cli.ts'

// Pre-existing bug found while implementing --llm auto (Track 4): --llm was in the
// boolean-only flag list alongside --json/--version, so a provider name typed after it
// (e.g. `--llm fireworks`) was never captured — it silently fell through to `positional`
// and `parsed.llm` was always `true`, making `--llm fireworks` behave identically to a
// bare `--llm`. This must be fixed for `--llm auto` to be distinguishable at all.
describe('parseArgs — --llm value capture', () => {
  it('captures a provider name after --llm', () => {
    const { parsed, positional } = parseArgs(['code', 'file.ts', '--llm', 'fireworks'])
    expect(parsed.llm).toBe('fireworks')
    expect(positional).toEqual(['code', 'file.ts'])
  })

  it('captures "auto" after --llm', () => {
    const { parsed } = parseArgs(['code', 'file.ts', '--llm', 'auto'])
    expect(parsed.llm).toBe('auto')
  })

  it('bare --llm with no following value stays boolean true', () => {
    const { parsed } = parseArgs(['code', 'file.ts', '--llm'])
    expect(parsed.llm).toBe(true)
  })

  it('bare --llm followed by another flag stays boolean true (does not eat the next flag)', () => {
    const { parsed } = parseArgs(['code', 'file.ts', '--llm', '--json'])
    expect(parsed.llm).toBe(true)
    expect(parsed.json).toBe(true)
  })

  it('--json and --version remain pure boolean flags, unaffected', () => {
    const { parsed, positional } = parseArgs(['code', 'file.ts', '--json'])
    expect(parsed.json).toBe(true)
    expect(positional).toEqual(['code', 'file.ts'])
  })
})
