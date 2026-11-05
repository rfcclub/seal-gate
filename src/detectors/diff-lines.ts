/**
 * Text the heuristics should judge: inside a unified diff hunk only added and
 * removed lines count; unchanged context lines, `@@` hunk headers and the
 * `diff --git` / `index` / `---` / `+++` file headers are dropped. Text outside
 * a diff (claims, plans, plain descriptions) is returned unchanged.
 */
export function changedText(text: string): string {
  if (!/^@@ .* @@/m.test(text)) return text
  const kept: string[] = []
  let inHunk = false
  for (const line of text.split('\n')) {
    if (/^@@ .* @@/.test(line)) { inHunk = true; continue }
    if (/^diff --git /.test(line)) { inHunk = false; continue }
    if (inHunk) {
      if (line.startsWith('+') || line.startsWith('-')) kept.push(line)
      else if (line.startsWith(' ') || line.startsWith('\\') || line === '') continue
      else { inHunk = false; kept.push(line) }
      continue
    }
    if (/^(index |--- |\+\+\+ |new file mode |deleted file mode |similarity index |rename (from|to) )/.test(line)) continue
    kept.push(line)
  }
  return kept.join('\n')
}
