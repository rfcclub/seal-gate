const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/

/** Splits a unified diff into the lines heuristics judge (`kept`) and the context lines it drops. */
function split(text: string): { kept: string[]; context: string[] } {
  const kept: string[] = []
  const context: string[] = []
  let oldLeft = 0
  let newLeft = 0
  let fileOpen = false
  for (const line of text.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('\\')) continue
      if (line.startsWith('-')) { oldLeft--; kept.push(line); continue }
      if (line.startsWith('+')) { newLeft--; kept.push(line); continue }
      if (line.startsWith(' ') || line === '') { oldLeft--; newLeft--; context.push(line); continue }
      oldLeft = newLeft = 0
      fileOpen = false
    }
    const hunk = fileOpen ? HUNK.exec(line) : null
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1])
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2])
      continue
    }
    fileOpen = line.startsWith('+++ ')
    kept.push(line)
  }
  return { kept, context }
}

/**
 * Text the heuristics should judge: inside a unified diff hunk only added and
 * removed lines count; unchanged context lines and `@@` hunk headers are dropped.
 * A hunk header counts only right after a `+++` file header or right after the
 * previous hunk of the same file, and a hunk ends after the old/new line counts
 * in its header, so text after it is kept. File header lines stay, because a
 * path such as `src/auth/check.ts` carries risk that the changed lines may not.
 * Text outside a diff is returned unchanged.
 *
 * With `reference` (the evidence diff), a context line of `text` is dropped only
 * when `reference` has the same context line, so prose dressed as a hunk in an
 * agent's output cannot hide from the heuristics.
 */
export function changedText(text: string, reference?: string): string {
  if (!/^@@ .* @@/m.test(text)) return text
  const { kept, context } = split(text)
  if (reference === undefined) return kept.join('\n')
  const known = new Set(/^@@ .* @@/m.test(reference) ? split(reference).context : [])
  return [...kept, ...context.filter((line) => !known.has(line))].join('\n')
}
