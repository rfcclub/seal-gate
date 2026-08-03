import { createHash } from 'node:crypto'
import { SealIssue, CitationStatus } from '../types.js'
import { getLines } from './evidence-cache.js'

export type EvidenceGrade = 'strong' | 'weak' | 'none'

export interface CitationVerdict {
  status: CitationStatus
  quality: EvidenceGrade
  similarScore: number
  isFabricated: boolean
  fabricatedReason?: 'location_not_found' | 'content_mismatch'
}

export interface AbsencePattern {
  positive: RegExp
  negated: RegExp
  label?: string
}

const SIMILARITY_STRONG = 0.85
const SIMILARITY_WEAK = 0.60

function normalize(str: string): string {
  return str.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Levenshtein distance between two strings */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  // Early termination for empty strings
  if (m === 0) return n
  if (n === 0) return m

  // Use two rows to reduce memory
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i)
  let curr: number[] = new Array(n + 1)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

/**
 * Fuzzy-match a quote against actual content.
 * Returns 0-1 similarity score where 1 = exact match.
 */
function fuzzyMatch(quote: string, content: string): number {
  const normQuote = normalize(quote)
  const normContent = normalize(content)
  if (normContent.length === 0 && normQuote.length === 0) return 1
  if (normContent.length === 0) return 0
  const dist = levenshtein(normQuote, normContent)
  const maxLen = Math.max(normQuote.length, normContent.length)
  if (maxLen === 0) return 1
  return Math.max(0, 1 - dist / maxLen)
}

/** Check if the issue describes an absence (something missing) */
function isAbsenceDescription(quote: string): boolean {
  return /^(no |missing |absent |lacks? |without )/i.test(quote.trim())
}

export class CitationVerifier {
  /** Compute SHA-256 hash of artifact content for pipeline integrity */
  static computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex')
  }

  /** Check pipeline integrity: preflight hash vs current hash */
  static checkIntegrity(preflightHash: string, currentHash: string): boolean {
    return preflightHash === currentHash
  }

  /**
   * Verify a single issue's citation against the actual artifact content.
   *
   * @param issue - The issue with evidence_file/evidence_lines/evidence_quote
   * @param artifact - The artifact string (input.output or input.evidence.diff)
   * @param artifactFile - The logical file name of the artifact
   * @param opts - Optional: absencePatterns for absence-mode verification
   * @returns CitationVerdict with status and quality
   */
  static verify(
    issue: SealIssue,
    artifact: string,
    artifactFile: string,
    opts?: { absencePatterns?: AbsencePattern[] },
  ): CitationVerdict {
    // No evidence fields → not_applicable
    if (!issue.evidence_file || !issue.evidence_lines || issue.evidence_lines.length === 0) {
      return { status: 'not_applicable', quality: 'none', similarScore: 0, isFabricated: false }
    }

    // If the issue cites a different file, skip (we only check against the main artifact)
    if (issue.evidence_file !== artifactFile) {
      return { status: 'not_applicable', quality: 'none', similarScore: 0, isFabricated: false }
    }

    const lines = getLines(artifact)
    const [lineA] = issue.evidence_lines

    // Phantom: line out of range
    if (lineA < 1 || lineA > lines.length) {
      return { status: 'phantom', quality: 'none', similarScore: 0, isFabricated: true, fabricatedReason: 'location_not_found' }
    }

    const lineContent = lines[lineA - 1] ?? ''
    const quote = issue.evidence_quote ?? ''

    // Absence mode: check if this looks like a "something is missing" description
    if (opts?.absencePatterns && opts.absencePatterns.length > 0 && isAbsenceDescription(quote)) {
      for (const pattern of opts.absencePatterns) {
        const hasPositive = pattern.positive.test(artifact)
        const hasNegated = pattern.negated.test(artifact)

        if (hasPositive && !hasNegated) {
          // Absence confirmed: positive anchor present, negated token absent
          return { status: 'verified', quality: 'strong', similarScore: 1, isFabricated: false }
        }
        if (hasPositive && hasNegated) {
          // Absence NOT confirmed: negated token IS present
          // This means the detector was wrong about the absence
          return { status: 'void', quality: 'none', similarScore: 0, isFabricated: true, fabricatedReason: 'content_mismatch' }
        }
        // No positive anchor → can't confirm, fall through to literal mode
      }
    }

    // Literal excerpt mode: fuzzy-match the quote against the line content
    const score = fuzzyMatch(quote, lineContent)

    if (score >= SIMILARITY_STRONG) {
      return { status: 'verified', quality: 'strong', similarScore: score, isFabricated: false }
    }
    if (score >= SIMILARITY_WEAK) {
      return { status: 'drifted', quality: 'weak', similarScore: score, isFabricated: false }
    }
    return { status: 'void', quality: 'none', similarScore: score, isFabricated: true, fabricatedReason: 'content_mismatch' }
  }

  /**
   * Verify multiple issues and annotate them with citation_status.
   * Returns fabricated_evidence entries for any that failed verification.
   */
  static verifyIssues(
    issues: SealIssue[],
    artifact: string,
    artifactFile: string,
    opts?: { absencePatterns?: AbsencePattern[] },
  ): { issues: SealIssue[]; fabricated: FabricatedEvidenceEntry[] } {
    const fabricated: FabricatedEvidenceEntry[] = []

    const annotated = issues.map(issue => {
      const verdict = this.verify(issue, artifact, artifactFile, opts)
      // Annotate the issue. A proven-fabricated citation (phantom/void) cannot keep its
      // original scoring/blocking power — the claim was never verified as true, so it
      // can't count as if it were (kernel/tactics separation — design.md AD-3).
      const updated: SealIssue = verdict.isFabricated
        ? { ...issue, citation_status: verdict.status, trust_deduction: 0, is_blocking: false }
        : { ...issue, citation_status: verdict.status }

      if (verdict.isFabricated) {
        fabricated.push({
          type: 'FABRICATED_EVIDENCE',
          severity: verdict.status === 'phantom' ? 'CRITICAL' : 'HIGH',
          is_blocking: false,
          evidence: `Detector claimed citation at ${issue.evidence_file}:${issue.evidence_lines?.[0]} but it was ${verdict.fabricatedReason}`,
          layer: 'L3',
          source: 'core',
          citation_status: verdict.status,
          fabricated_reason: verdict.fabricatedReason!,
          claimed_evidence: {
            file: issue.evidence_file,
            lines: issue.evidence_lines,
            quote: issue.evidence_quote,
          },
        })
      }

      return updated
    })

    return { issues: annotated, fabricated }
  }
}

export interface FabricatedEvidenceEntry {
  type: 'FABRICATED_EVIDENCE'
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  is_blocking: boolean
  evidence: string
  layer: IssueLayer
  source: 'core' | 'llm-overlay' | 'extension'
  citation_status: CitationStatus
  fabricated_reason: 'location_not_found' | 'content_mismatch'
  claimed_evidence: {
    file?: string
    lines?: number[]
    quote?: string
  }
}

type IssueLayer = 'L1' | 'L2' | 'L3' | 'L4' | 'EXTENSION' | 'LLM_OVERLAY'
