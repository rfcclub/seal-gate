import { describe, it, expect } from 'bun:test'
import { getLines, _evidenceCacheSizeForTest } from '../../src/engine/evidence-cache.ts'

// citation-verifier.ts calls getLines() once per issue it verifies — CitationVerifier.verifyIssues()
// checks many issues against the SAME artifact string in one batch, so without memoization the
// same string gets re-split on every single issue. This is the OnceMap-style "don't redo the
// same work twice" pattern (see openspec/changes/verifiable-gate-hardening/design.md AD-4),
// scoped to what the code actually does: no file I/O here, just redundant string splitting.
describe('evidence-cache: getLines memoization', () => {
  it('returns the same array reference for the same artifact string (no re-split)', () => {
    const artifact = 'line one\nline two\nline three'
    const a = getLines(artifact)
    const b = getLines(artifact)
    expect(a).toBe(b) // reference equality — proves it was not recomputed
    expect(a).toEqual(['line one', 'line two', 'line three'])
  })

  it('returns different content for different artifact strings', () => {
    const a = getLines('foo\nbar')
    const b = getLines('baz\nqux')
    expect(a).toEqual(['foo', 'bar'])
    expect(b).toEqual(['baz', 'qux'])
  })

  it('caps cache size so it cannot grow unbounded across a long-lived process', () => {
    for (let i = 0; i < 50; i++) getLines(`unique-artifact-${i}\nline2`)
    expect(_evidenceCacheSizeForTest()).toBeLessThanOrEqual(8)
  })
})
