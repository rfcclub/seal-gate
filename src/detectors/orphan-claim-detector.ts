import { Claim, SealIssue, makeIssue } from '../types.ts'

// Anchor patterns: what counts as a traceable upstream reference
const ANCHOR_PATTERNS: RegExp[] = [
  /\bREQ-\d+\b/,
  /\bAC-\d+\b/,
  /\bphase\.json\b/,
  /\bintent\.md\b/,
  /\bself-check\.md\b/,
  /\bper\s+(spec|intent|design|plan|requirement)/i,
  /\bper\s+§/i,
  /§\w/,                       // section reference
  /\[verified\]/i,
  /\[inferred\]/i,
  /\bassumes?\b.*\bknown\b/i,
]

function hasAnchor(claimText: string, surroundingContext: string): boolean {
  const combined = claimText + ' ' + surroundingContext
  return ANCHOR_PATTERNS.some(p => p.test(combined))
}

function extractContext(artifact: string, pos: number, radius = 200): string {
  const start = Math.max(0, pos - radius)
  const end = Math.min(artifact.length, pos + radius)
  return artifact.slice(start, end)
}

export interface OrphanClaimResult {
  issues: SealIssue[]
}

export class OrphanClaimDetector {
  static detect(claims: Claim[], artifact: string): OrphanClaimResult {
    const issues: SealIssue[] = []

    for (const claim of claims) {
      if (!claim.requires_evidence) continue

      const context = extractContext(artifact, claim.start_pos)
      if (hasAnchor(claim.text, context)) continue

      // Untraceable — MISSING_EVIDENCE (weak/non-blocking per spec)
      issues.push({
        ...makeIssue({
          type: 'MISSING_EVIDENCE',
          severity: 'LOW',       // stays non-blocking per spec design
          layer: 'L3',
          source: 'core',
          rule_id: 'PR003',
          trust_deduction: 5,    // partial -20 from spec applied across multiple orphans
          evidence: `Orphan claim — no traceable anchor (REQ/AC/intent/phase.json): "${claim.text.slice(0, 80)}"`,
          suggested_fix: 'Add a REQ-N, AC-N, or §-reference anchoring this claim to an upstream artifact',
        }),
        confidence: 0.7,
        policy_tags: ['traceability'],
      })
    }

    return { issues }
  }
}
