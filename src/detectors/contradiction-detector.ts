import { SealIssue, makeIssue } from '../types.ts'

export interface ContradictionDetectorInput {
  artifact: string
  artifact_file?: string
}

interface Section {
  heading: string
  body: string
  startLine: number
}

// Conflict patterns: [write side pattern, readonly side pattern, description]
const CONFLICT_PAIRS: Array<[RegExp, RegExp, string]> = [
  [/\b(writes?|modifies?|overwrites?|creates?)\s+(\S+)/gi, /\b(\S+)\s+(is\s+)?(read.?only|append.?only|immutable|locked|mutex)/gi, 'write vs readonly constraint'],
  [/\b(removes?|deletes?|drops?)\s+(\S+)/gi, /\b(requires?|depends?\s+on|needs?)\s+(\S+)/gi, 'remove vs dependency'],
  [/step\s+(\d+)\s+.*?(writes?|creates?)\s+(\S+)/gi, /(\S+)\s+must\s+(exist|be\s+present)\s+before\s+step\s+(\d+)/gi, 'step ordering'],
]

// Non-goal violation: "non-goal: X" but body contains "SHALL/WILL/MUST X"
const NON_GOAL_PATTERN = /non.?goals?\s*:?\s*([^\n]+)/gi
const GOAL_CLAIM_PATTERN = /\b(shall|will|must|implement|add|support)\s+(\S+)/gi

function parseLines(text: string): string[] {
  return text.split('\n')
}

// Strip code fences and inline code so pattern matching operates on prose only
function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')   // block fences
    .replace(/`[^`\n]+`/g, ' ')         // inline code
    .replace(/^\s*[-*]\s+\[[ x]\]\s*/gm, ' ') // task checkboxes
}

function extractSections(text: string): Section[] {
  const lines = parseLines(text)
  const sections: Section[] = []
  let current: Section | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^#{1,4}\s/.test(line)) {
      if (current) sections.push(current)
      current = { heading: line.replace(/^#{1,4}\s*/, ''), body: '', startLine: i + 1 }
    } else if (current) {
      current.body += line + '\n'
    }
  }
  if (current) sections.push(current)
  return sections
}

function findLineNumber(text: string, searchStr: string): number {
  const lines = parseLines(text)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchStr)) return i + 1
  }
  return 1
}

export interface ContradictionResult {
  issues: SealIssue[]
  confirmed_strong_fields: number
}

export class ContradictionDetector {
  static detect(input: ContradictionDetectorInput): ContradictionResult {
    const { artifact, artifact_file = 'artifact' } = input
    const issues: SealIssue[] = []
    const sections = extractSections(artifact)

    // Pairwise cross-section scan for write/readonly conflicts
    for (let i = 0; i < sections.length; i++) {
      for (let j = 0; j < sections.length; j++) {
        if (i === j) continue
        const secA = sections[i]
        const secB = sections[j]
        const proseA = stripCode(secA.body)
        const proseB = stripCode(secB.body)

        for (const [writePattern, readonlyPattern, desc] of CONFLICT_PAIRS) {
          writePattern.lastIndex = 0
          readonlyPattern.lastIndex = 0

          const writeMatcher = writePattern.exec(proseA)
          const readonlyMatcher = readonlyPattern.exec(proseB)

          if (!writeMatcher || !readonlyMatcher) continue

          const lineA = secA.startLine + (secA.body.slice(0, writeMatcher.index).split('\n').length - 1)
          const lineB = secB.startLine + (secB.body.slice(0, readonlyMatcher.index).split('\n').length - 1)

          // Only emit once per pair (lower section index first)
          if (i > j) continue

          const quote = `§${secA.heading}: '${writeMatcher[0]}' || §${secB.heading}: '${readonlyMatcher[0]}'`

          issues.push({
            ...makeIssue({
              type: 'LOGIC_BUG',
              severity: 'HIGH',
              layer: 'L1',
              source: 'core',
              rule_id: 'PR001',
              required_verdict: 'BLOCK',
              trust_deduction: 20,
              evidence: `Contradiction (${desc}): ${quote}`,
              suggested_fix: `Reconcile §${secA.heading} with §${secB.heading}`,
            }),
            evidence_file: artifact_file,
            evidence_lines: [lineA, lineB],
            evidence_quote: quote,
            confidence: 0.85,
            policy_tags: ['consistency'],
          })
        }
      }
    }

    // Non-goal violation scan — operate on prose only
    const artifactProse = stripCode(artifact)
    NON_GOAL_PATTERN.lastIndex = 0
    let ngMatch: RegExpExecArray | null
    while ((ngMatch = NON_GOAL_PATTERN.exec(artifactProse)) !== null) {
      const ngText = ngMatch[1].trim().toLowerCase()
      const ngLine = findLineNumber(artifact, ngMatch[0].slice(0, 40))

      GOAL_CLAIM_PATTERN.lastIndex = 0
      let gcMatch: RegExpExecArray | null
      while ((gcMatch = GOAL_CLAIM_PATTERN.exec(artifactProse)) !== null) {
        const claimTarget = (gcMatch[2] ?? '').toLowerCase()
        // Rough match: non-goal keyword appears in a SHALL/MUST claim
        if (claimTarget && ngText.includes(claimTarget.slice(0, 5))) {
          const claimLine = findLineNumber(artifact, gcMatch[0].slice(0, 40))
          if (Math.abs(claimLine - ngLine) < 3) continue // same line, skip

          const quote = `Non-goal: '${ngText}' || Goal claim: '${gcMatch[0]}'`
          issues.push({
            ...makeIssue({
              type: 'LOGIC_BUG',
              severity: 'HIGH',
              layer: 'L1',
              source: 'core',
              rule_id: 'PR001',
              required_verdict: 'BLOCK',
              trust_deduction: 20,
              evidence: `Non-goal violated: ${quote}`,
              suggested_fix: 'Remove claim or move item out of non-goals',
            }),
            evidence_file: artifact_file,
            evidence_lines: [ngLine, claimLine],
            evidence_quote: quote,
            confidence: 0.8,
            policy_tags: ['consistency'],
          })
          break // one violation per non-goal entry
        }
      }
    }

    return { issues, confirmed_strong_fields: 0 }
  }
}
