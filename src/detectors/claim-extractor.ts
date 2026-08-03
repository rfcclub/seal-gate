import { Claim, ClaimType, StructuralClaim, StructuralClaimType } from '../types.js'

const CLAIM_PATTERNS: Array<{ type: ClaimType; pattern: RegExp }> = [
  { type: 'test_result_claim',    pattern: /\b(all tests? pass(?:ed)?|tests? pass(?:ed)?|verified|tested)\b/gi },
  { type: 'implementation_claim', pattern: /\b(implemented|fixed|completed|resolved|built|deployed)\b/gi },
  { type: 'compatibility_claim',  pattern: /\b(backward.?compatible|no breaking changes|fully compatible)\b/gi },
  { type: 'risk_claim',           pattern: /\b(no security impact|no risk of (?:breach|exploit|injection|attack)|safe to (?:deploy|release|merge)|security[- ](?:free|cleared)|no (?:auth|security) (?:change|impact|risk))\b/gi },
  { type: 'build_claim',          pattern: /\b(build succeeded|compiled|build pass(?:ed)?|build is (?:clean|green))\b/gi },
  { type: 'production_claim',     pattern: /\b(production.?ready|ready for (?:production|deploy|release))\b/gi },
  { type: 'generic_claim',        pattern: /\b(definitely|guaranteed|fully|completely|all good|no issues)\b/gi },
]

/**
 * Structural patterns for extracting claims from code diffs.
 * Each pattern targets a specific structural concern.
 */
const STRUCTURAL_PATTERNS: Array<{
  type: StructuralClaimType
  detect: RegExp
  extract: (match: RegExpExecArray, lineNum: number, diff: string) => StructuralClaim | null
}> = [
  // HTTP endpoint detection (Express/Fastify, NestJS, Hono, Python Flask/FastAPI, Go Gin)
  {
    type: 'structural_endpoint',
    detect: /(?:app|router|route|server)\.(?:get|post|put|delete|patch|all)\(['"`](\/[^'"`]+)['"`]/gi,
    extract: (match, lineNum) => ({
      type: 'structural_endpoint' as StructuralClaimType,
      target: match[1],
      line: lineNum,
      description: `HTTP endpoint: ${match[1]}`,
      change_type: 'added',
    }),
  },
  // Decorator-based endpoints (NestJS, Spring, FastAPI)
  {
    type: 'structural_endpoint',
    detect: /@(?:Get|Post|Put|Delete|Patch)\(['"`]?(\/[^'"`) ]*)?['"`]?\)/gi,
    extract: (match, lineNum) => ({
      type: 'structural_endpoint' as StructuralClaimType,
      target: match[1] || '/',
      line: lineNum,
      description: `Decorator endpoint: ${match[1] || '/'}`,
      change_type: 'added',
    }),
  },
  // Auth-related changes — match auth, guard, middleware constructs
  {
    type: 'structural_auth',
    detect: /(?:@Authenticated|@Authorize|requireAuth|ensureAuth|authenticate|authorize)\b|\b(auth|guard)\b/gi,
    extract: (match, lineNum) => ({
      type: 'structural_auth' as StructuralClaimType,
      target: match[0],
      line: lineNum,
      description: `Auth construct: ${match[0]}`,
      change_type: 'modified',
    }),
  },
  // Database migrations — SQL + ORM-based (createTable, create_table)
  {
    type: 'structural_migration',
    detect: /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|migration.*\.[a-z]+|schema\.php|createTable|create_table)\b/gi,
    extract: (match, lineNum, diff) => {
      const lines = diff.split('\n')
      const context = lines.slice(Math.max(0, lineNum - 3), lineNum + 2).join('\n')
      const hasRollback = /\b(rollback|down\s+migration|revert)\b/i.test(context)
      return {
        type: 'structural_migration' as StructuralClaimType,
        target: match[0],
        line: lineNum,
        description: `Migration: ${match[0]}`,
        has_rollback: hasRollback,
        change_type: 'added',
      }
    },
  },
  // Dependency manifest changes
  {
    type: 'structural_dependency',
    detect: /^[+-]\s+(['"`]?@?\w[^'"]*['"`]?\s*:\s*['"`]?\^?[\d.]+['"`]?)/gm,
    extract: (match, lineNum, diff) => {
      const isAdded = match[0].startsWith('+')
      return {
        type: 'structural_dependency' as StructuralClaimType,
        target: match[1]?.trim() || match[0].trim(),
        line: lineNum,
        description: `Dependency ${isAdded ? 'added' : 'removed'}: ${match[1]?.trim() || ''}`,
        change_type: isAdded ? 'added' : 'removed',
      }
    },
  },
]

function stripCodeFences(text: string): { stripped: string; fenceRanges: Array<[number, number]> } {
  const fenceRanges: Array<[number, number]> = []
  const blockFence = /```[\s\S]*?```/g
  let match: RegExpExecArray | null
  while ((match = blockFence.exec(text)) !== null) {
    fenceRanges.push([match.index, match.index + match[0].length])
  }
  const inlineFence = /`[^`\n]+`/g
  while ((match = inlineFence.exec(text)) !== null) {
    fenceRanges.push([match.index, match.index + match[0].length])
  }
  return { stripped: text, fenceRanges }
}

function isInFence(pos: number, fenceRanges: Array<[number, number]>): boolean {
  return fenceRanges.some(([start, end]) => pos >= start && pos < end)
}

function getLineNumber(text: string, pos: number): number {
  return text.slice(0, pos).split('\n').length
}

export class ClaimExtractor {
  /** Extract behavioral claims from output text */
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

        let overlaps = false
        for (const span of usedSpans) {
          const [s, e] = span.split('-').map(Number)
          if (start < (e ?? 0) && end > (s ?? 0)) { overlaps = true; break }
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

  /**
   * Extract structural claims from a code diff.
   * The diff should be in unified diff format (git diff output or similar).
   */
  static extractStructural(diff: string): StructuralClaim[] {
    if (!diff || diff.trim() === '') return []

    const claims: StructuralClaim[] = []
    const lines = diff.split('\n')

    // If it looks like a git diff, only scan added/modified lines
    const isGitDiff = diff.includes('diff --git') || diff.includes('--- a/')
    const contentLines: Array<{ text: string; lineNum: number }> = []

    if (isGitDiff) {
      let currentLine = 0
      for (const line of lines) {
        currentLine++
        // Only scan added/modified lines (starting with +) and context/diff headers
        if (line.startsWith('+')) {
          contentLines.push({ text: line.slice(1), lineNum: currentLine })
        }
        // Also check diff headers for file names (package.json, migrations, etc.)
        if (line.startsWith('diff --git')) {
          contentLines.push({ text: line, lineNum: currentLine })
        }
        // Check for migration files in diff headers
        if (line.startsWith('+++ b/') || line.startsWith('--- a/')) {
          contentLines.push({ text: line, lineNum: currentLine })
        }
      }
    } else {
      // Plain text — use all lines
      lines.forEach((text, i) => contentLines.push({ text, lineNum: i + 1 }))
    }

    // Scan for structural patterns
    for (const { type, detect, extract } of STRUCTURAL_PATTERNS) {
      detect.lastIndex = 0
      const singleContent = contentLines.map(l => l.text).join('\n')

      let match: RegExpExecArray | null
      while ((match = detect.exec(singleContent)) !== null) {
        const matchLineNum = getLineNumber(singleContent, match.index)
        // Find the closest content line
        const contentLine = contentLines.find(l => l.lineNum >= matchLineNum) ?? contentLines[contentLines.length - 1]
        if (!contentLine) continue

        const claim = extract(match, contentLine.lineNum, singleContent)
        if (claim && !claims.some(c => c.type === claim.type && c.target === claim.target && c.line === claim.line)) {
          claims.push(claim)
        }
      }
    }

    return claims
  }
}
