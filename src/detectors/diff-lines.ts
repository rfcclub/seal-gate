const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/

/**
 * Text the heuristics should judge: inside a unified diff hunk only added and
 * removed lines count; unchanged context lines and `@@` hunk headers are dropped.
 * A hunk header counts only right after a `+++` file header or right after the
 * previous hunk of the same file, so an `@@` line in prose is kept as text.
 * A hunk ends after the old/new line counts in its header, so text after it is
 * kept. File header lines stay, because a path such as `src/auth/check.ts`
 * carries risk that the changed lines may not. Text outside a diff is returned
 * unchanged.
 */
export function changedText(text: string): string {
  if (!/^@@ .* @@/m.test(text)) return text
  const kept: string[] = []
  let oldLeft = 0
  let newLeft = 0
  let fileOpen = false
  for (const line of text.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('\\')) continue
      if (line.startsWith('-')) { oldLeft--; kept.push(line); continue }
      if (line.startsWith('+')) { newLeft--; kept.push(line); continue }
      if (line.startsWith(' ') || line === '') { oldLeft--; newLeft--; continue }
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
  return kept.join('\n')
}
