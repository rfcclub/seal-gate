/**
 * Memoizes artifact.split('\n') within/across CitationVerifier.verify() calls.
 * CitationVerifier.verifyIssues() checks many issues against the same artifact string in
 * one batch — without this, the same string gets re-split once per issue. OnceMap-style
 * "don't redo the same work twice" (see openspec/changes/verifiable-gate-hardening/design.md
 * AD-4), scoped to what this codebase actually does: no file I/O here, just redundant
 * string splitting on an already-in-memory artifact.
 *
 * Capped at MAX_ENTRIES so a long-lived process (e.g. a library consumer running many
 * reviews) can't grow this Map unbounded — oldest entry is evicted first (Map preserves
 * insertion order).
 */
const MAX_ENTRIES = 8
const cache = new Map<string, string[]>()

export function getLines(artifact: string): string[] {
  const cached = cache.get(artifact)
  if (cached) return cached

  const lines = artifact.split('\n')
  cache.set(artifact, lines)

  if (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value as string
    cache.delete(oldestKey)
  }

  return lines
}

/** Test-only: current cache size, to verify the eviction cap holds. */
export function _evidenceCacheSizeForTest(): number {
  return cache.size
}
