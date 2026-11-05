/**
 * Text the heuristics should judge: inside a unified diff hunk only added and
 * removed lines count; unchanged context lines and `@@` hunk headers are dropped.
 * File header lines stay, because a path such as `src/auth/check.ts` carries risk
 * that the changed lines may not. Text outside a diff is returned unchanged.
 */
export function changedText(text: string): string {
  if (!/^@@ .* @@/m.test(text)) return text
  const kept: string[] = []
  let inHunk = false
  for (const line of text.split('\n')) {
    if (/^@@ .* @@/.test(line)) { inHunk = true; continue }
    if (/^diff --git /.test(line)) inHunk = false
    if (inHunk) {
      if (line.startsWith('+') || line.startsWith('-')) kept.push(line)
      else if (line.startsWith(' ') || line.startsWith('\\') || line === '') continue
      else { inHunk = false; kept.push(line) }
      continue
    }
    kept.push(line)
  }
  return kept.join('\n')
}
