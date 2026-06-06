import { Claim, ClaimType } from '../types.ts'

const CLAIM_PATTERNS: Array<{ type: ClaimType; pattern: RegExp }> = [
  { type: 'test_result_claim',    pattern: /\b(all tests? pass(?:ed)?|tests? pass(?:ed)?|verified|tested)\b/gi },
  { type: 'implementation_claim', pattern: /\b(implemented|fixed|completed|resolved|built|deployed)\b/gi },
  { type: 'compatibility_claim',  pattern: /\b(backward.?compatible|no breaking changes|fully compatible)\b/gi },
  { type: 'risk_claim',           pattern: /\b(no security impact|safe|secure|no risk)\b/gi },
  { type: 'build_claim',          pattern: /\b(build succeeded|compiled|build pass(?:ed)?|build is (?:clean|green))\b/gi },
  { type: 'production_claim',     pattern: /\b(production.?ready|ready for (?:production|deploy|release))\b/gi },
  { type: 'generic_claim',        pattern: /\b(definitely|guaranteed|fully safe|all good|no issues)\b/gi },
]

function stripCodeFences(text: string): { stripped: string; fenceRanges: Array<[number, number]> } {
  const fenceRanges: Array<[number, number]> = []
  // Block code fences (``` ... ```)
  const blockFence = /```[\s\S]*?```/g
  let match: RegExpExecArray | null
  while ((match = blockFence.exec(text)) !== null) {
    fenceRanges.push([match.index, match.index + match[0].length])
  }
  // Inline code (`...`)
  const inlineFence = /`[^`\n]+`/g
  while ((match = inlineFence.exec(text)) !== null) {
    fenceRanges.push([match.index, match.index + match[0].length])
  }
  return { stripped: text, fenceRanges }
}

function isInFence(pos: number, fenceRanges: Array<[number, number]>): boolean {
  return fenceRanges.some(([start, end]) => pos >= start && pos < end)
}

export class ClaimExtractor {
  static extract(text: string): Claim[] {
    const { fenceRanges } = stripCodeFences(text)
    const usedSpans = new Set<string>()
    const claims: Claim[] = []

    for (const { type, pattern } of CLAIM_PATTERNS) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text)) !== null) {
        const start = match.index
        const end = match.index + match[0].length
        const spanKey = `${start}-${end}`

        if (isInFence(start, fenceRanges)) continue
        if (usedSpans.has(spanKey)) continue

        // Check no smaller overlap with existing spans
        let overlaps = false
        for (const span of usedSpans) {
          const [s, e] = span.split('-').map(Number)
          if (start < e && end > s) { overlaps = true; break }
        }
        if (overlaps) continue

        usedSpans.add(spanKey)
        claims.push({ text: match[0], type, start_pos: start, end_pos: end, requires_evidence: true })
      }
    }

    return claims.sort((a, b) => a.start_pos - b.start_pos)
  }

  static getUsedSpans(claims: Claim[]): Set<string> {
    return new Set(claims.map(c => `${c.start_pos}-${c.end_pos}`))
  }
}
