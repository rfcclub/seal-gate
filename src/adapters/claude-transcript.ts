import { readFileSync } from 'node:fs'

export interface TranscriptTurn {
  role: 'user' | 'assistant'
  content: string
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: unknown): b is { type: string; text?: string } => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
  }
  return ''
}

/**
 * Reads a Claude Code JSONL transcript and returns the last `maxTurns`
 * user/assistant turns, oldest first — not just the single last user
 * message. A Stop-hook reviewer scoring "did this introduce behavior not
 * requested?" against only the literal last line can't see the
 * conversational frame (e.g. an ongoing Q&A thread vs. a build request)
 * that disambiguates it — see seal-gate USAGE notes, 2026-09-05.
 */
export function extractRecentTurns(transcriptPath: string, maxTurns = 6): TranscriptTurn[] {
  let lines: string[]
  try {
    lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n')
  } catch {
    return []
  }

  const turns: TranscriptTurn[] = []
  for (let i = lines.length - 1; i >= 0 && turns.length < maxTurns; i--) {
    let entry: unknown
    try {
      entry = JSON.parse(lines[i])
    } catch {
      continue
    }
    const msg = (entry as { message?: unknown })?.message ?? entry
    const role = (msg as { role?: unknown })?.role
    if (role !== 'user' && role !== 'assistant') continue
    turns.push({ role, content: extractText((msg as { content?: unknown }).content) })
  }

  return turns.reverse()
}

/** Renders turns as `[role] content` blocks, in chronological order. */
export function formatRecentContext(turns: TranscriptTurn[]): string {
  return turns.map((t) => `[${t.role}] ${t.content}`).join('\n\n')
}
