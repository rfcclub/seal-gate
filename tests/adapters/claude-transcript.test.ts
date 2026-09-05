import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractRecentTurns, formatRecentContext } from '../../src/adapters/claude-transcript.ts'

let dir: string | undefined

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function writeTranscript(lines: unknown[]): string {
  dir = mkdtempSync(join(tmpdir(), 'seal-gate-transcript-'))
  const path = join(dir, 'transcript.jsonl')
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8')
  return path
}

function turn(role: 'user' | 'assistant', content: string) {
  return { message: { role, content } }
}

describe('extractRecentTurns', () => {
  it('returns the last N turns in chronological order, not just the single last message', () => {
    const path = writeTranscript([
      turn('user', 'turn 1 user'),
      turn('assistant', 'turn 1 assistant'),
      turn('user', 'turn 2 user'),
      turn('assistant', 'turn 2 assistant'),
      turn('user', 'turn 3 user'),
      turn('assistant', 'turn 3 assistant'),
    ])
    const turns = extractRecentTurns(path, 4)
    expect(turns).toEqual([
      { role: 'user', content: 'turn 2 user' },
      { role: 'assistant', content: 'turn 2 assistant' },
      { role: 'user', content: 'turn 3 user' },
      { role: 'assistant', content: 'turn 3 assistant' },
    ])
  })

  it('handles block-array content the same way the single-message extractors do', () => {
    const path = writeTranscript([
      { message: { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] } },
    ])
    const turns = extractRecentTurns(path, 6)
    expect(turns).toEqual([{ role: 'user', content: 'hello\nworld' }])
  })

  it('skips malformed lines without crashing', () => {
    dir = mkdtempSync(join(tmpdir(), 'seal-gate-transcript-'))
    const path = join(dir, 'transcript.jsonl')
    writeFileSync(path, 'not json\n' + JSON.stringify(turn('user', 'ok line')) + '\n', 'utf-8')
    const turns = extractRecentTurns(path, 6)
    expect(turns).toEqual([{ role: 'user', content: 'ok line' }])
  })

  it('returns an empty array when the transcript file does not exist', () => {
    const turns = extractRecentTurns('/nonexistent/path/transcript.jsonl', 6)
    expect(turns).toEqual([])
  })

  it('ignores non-user/assistant roles (e.g. system) when counting turns', () => {
    const path = writeTranscript([
      turn('user', 'u1'),
      { message: { role: 'system', content: 'sys note' } },
      turn('assistant', 'a1'),
    ])
    const turns = extractRecentTurns(path, 6)
    expect(turns).toEqual([
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
    ])
  })
})

describe('formatRecentContext', () => {
  it('renders turns as [role] content blocks, in order', () => {
    const text = formatRecentContext([
      { role: 'user', content: 'hiển thị theo table' },
      { role: 'assistant', content: 'đã build table UI' },
    ])
    expect(text).toBe('[user] hiển thị theo table\n\n[assistant] đã build table UI')
  })

  it('returns an empty string for no turns', () => {
    expect(formatRecentContext([])).toBe('')
  })
})
