import { SealIssue, RiskLevel, SealEvidence, StructuralClaim, makeIssue } from '../types.js'

/**
 * Group definitions for overconfident language detection.
 * Each group has:
 * - patterns: regex patterns to match
 * - category: human-readable category name
 * - requires_evidence: whether matching requires supporting evidence
 * - correlation_fn: optional function to cross-correlate with structural claims
 */
interface ConfidenceGroup {
  id: string
  label: string
  patterns: RegExp[]
  requires_evidence: boolean
  evidence_type?: 'test_log' | 'security' | 'compatibility'
  severity: 'MEDIUM' | 'HIGH'
  correlation_fn?: (structuralClaims: StructuralClaim[]) => boolean
}

const GROUPS: ConfidenceGroup[] = [
  // Group A — Completeness
  {
    id: 'A',
    label: 'complete',
    patterns: [
      /\bfully\s+implemented\b/gi,
      /\bfully\s+(?:tested|working|functional)\b/gi,
      /\bhandles?\s+all\s+(edge\s+)?cases\b/gi,
      /\b100%\s+complete\b/gi,
    ],
    requires_evidence: false,
    severity: 'MEDIUM',
  },
  // Group B — Correctness
  {
    id: 'B',
    label: 'correctness',
    patterns: [
      /\ball\s+tests?\s+pass(?:ed)?\b/gi,
      /\bverified\s+correct\b/gi,
      /\bbug-free\b/gi,
      /\bguaranteed\b/gi,
    ],
    requires_evidence: true,
    evidence_type: 'test_log',
    severity: 'MEDIUM',
  },
  // Group C — Safety/Security
  {
    id: 'C',
    label: 'security',
    patterns: [
      /\bsecure\b/gi,
      /\bno\s+security\s+impact\b/gi,
      /\bno\s+vulnerabilit(?:y|ies)\b/gi,
    ],
    requires_evidence: true,
    evidence_type: 'security',
    severity: 'HIGH',
  },
  // Group D — Compatibility
  {
    id: 'D',
    label: 'compatibility',
    patterns: [
      /\bbackward\s+compatible\b/gi,
      /\bno\s+breaking\s+changes?\b/gi,
      /\bsafe\s+to\s+deploy\b/gi,
    ],
    requires_evidence: true,
    evidence_type: 'compatibility',
    severity: 'HIGH',
    correlation_fn: (structuralClaims: StructuralClaim[]) => {
      // If there are any endpoint changes, compatibility claims need extra scrutiny
      return structuralClaims.some(c => c.type === 'structural_endpoint' || c.type === 'structural_migration')
    },
  },
  // Group E — Readiness
  {
    id: 'E',
    label: 'readiness',
    patterns: [
      /\bproduction[- ]ready\b/gi,
      /\bready\s+to\s+ship\b/gi,
      /\bdeploy-ready\b/gi,
      /\bready\s+for\s+(production|deploy|release)\b/gi,
    ],
    requires_evidence: true,
    evidence_type: 'test_log',
    severity: 'HIGH',
  },
]

export interface ConfidenceLangResult {
  issues: SealIssue[]
  trust_deductions: number
  advisory_notes: string[]
  matched_groups: Array<{ group: string; phrase: string }>
}

function hasEvidenceEvidence(evidence: SealEvidence, type: string): boolean {
  switch (type) {
    case 'test_log':
      return evidence.test_log.trim().length > 0
    case 'security':
      return evidence.test_log.trim().length > 0 &&
        /security|auth|unauthorized|pentest|vuln|safe|protect/i.test(evidence.test_log)
    case 'compatibility':
      return evidence.diff.trim().length > 0 // diff itself is a form of compatibility evidence
    default:
      return false
  }
}

export class ConfidenceLanguageDetector {
  static detect(params: {
    output: string
    risk_level: RiskLevel
    evidence: SealEvidence
    deduped_spans: Set<string>
    structural_claims?: StructuralClaim[]
  }): ConfidenceLangResult {
    const { output, risk_level, evidence, deduped_spans, structural_claims = [] } = params
    const issues: SealIssue[] = []
    const advisory_notes: string[] = []
    const matched_groups: Array<{ group: string; phrase: string }> = []
    let trust_deductions = 0

    const riskOrder = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    const isHighPlus = riskOrder.indexOf(risk_level) >= riskOrder.indexOf('HIGH')
    const isLowEvidence = evidence.references.length === 0 && evidence.test_log.trim() === '' &&
      evidence.build_log.trim() === '' && evidence.diff.trim() === ''

    // Count total matches for OVERCONFIDENT_PATTERN advisory
    let totalMatches = 0
    const allPhrases: string[] = []

    // Generic overconfident phrases (catch-all for phrases not in groups A-E)
    const GENERIC_OVERCONFIDENT = /\b(definitely|all\s+good|no\s+issues|completely)\b/gi
    let genMatch: RegExpExecArray | null
    while ((genMatch = GENERIC_OVERCONFIDENT.exec(output)) !== null) {
      totalMatches++
      allPhrases.push(genMatch[0])
      matched_groups.push({ group: 'generic', phrase: genMatch[0] })
      trust_deductions += 5
    }

    // CL402: hedging language on HIGH+ risk (backward compat)
    const HEDGING_PATTERN = /\b(probably|should\s+work|seems|might|appears\s+to|I\s+think)\b/gi
    if (isHighPlus) {
      HEDGING_PATTERN.lastIndex = 0
      if (HEDGING_PATTERN.exec(output) !== null) {
        issues.push(makeIssue({
          type: 'AMBIGUITY', severity: 'HIGH', layer: 'L4', source: 'core',
          rule_id: 'CL402', required_verdict: 'ESCALATE_TO_HUMAN',
          evidence: `Hedging language in ${risk_level} risk artifact`,
          required_fix: 'Either assert with evidence or escalate to human review',
        }))
      }
    }

    for (const group of GROUPS) {
      for (const pattern of group.patterns) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(output)) !== null) {
          totalMatches++
          allPhrases.push(match[0])

          // Track matched group
          matched_groups.push({ group: group.id, phrase: match[0] })

          // Check if phrase is inside code fence (skip if deduped_spans contains it)
          const spanKey = `${match.index}-${match.index + match[0].length}`
          if (deduped_spans.has(spanKey)) continue

          // Deduction for any overconfident phrase
          trust_deductions += 5

          if (group.requires_evidence) {
            const hasEvidence = hasEvidenceEvidence(evidence, group.evidence_type!)

            // Group D: check correlation with structural claims
            if (group.id === 'D' && group.correlation_fn) {
              const hasEndpointChanges = group.correlation_fn(structural_claims)
              if (!hasEvidence && hasEndpointChanges) {
                issues.push(makeIssue({
                  type: 'COMPATIBILITY_RISK',
                  severity: 'HIGH',
                  layer: 'L4',
                  source: 'core',
                  rule_id: `CL-${group.id}01`,
                  required_verdict: isHighPlus ? 'ESCALATE_TO_HUMAN' : 'REVISE',
                  evidence: `"${match[0]}" claimed but endpoint/migration changes exist and no compatibility evidence provided`,
                  required_fix: 'Provide backward-compatibility analysis or remove the claim',
                }))
                trust_deductions += 15
              } else if (!hasEvidence) {
                issues.push(makeIssue({
                  type: 'MISSING_EVIDENCE',
                  severity: group.severity,
                  layer: 'L3',
                  source: 'core',
                  rule_id: `CL-${group.id}02`,
                  evidence: `"${match[0]}" without supporting ${group.evidence_type} evidence`,
                  required_fix: `Provide ${group.evidence_type} evidence or qualify the claim`,
                }))
                trust_deductions += 15
              }
            } else if (!hasEvidence && group.id === 'B') {
              // Group B: correctness without test evidence
              issues.push(makeIssue({
                type: 'MISSING_EVIDENCE',
                severity: 'MEDIUM',
                layer: 'L3',
                source: 'core',
                rule_id: `CL-${group.id}01`,
                evidence: `"${match[0]}" without test execution evidence`,
                required_fix: 'Provide test_log demonstrating test coverage',
              }))
              trust_deductions += 10
            } else if (!hasEvidence && group.id === 'C') {
              // Group C: security without security evidence
              issues.push(makeIssue({
                type: 'MISSING_EVIDENCE',
                severity: 'HIGH',
                layer: 'L3',
                source: 'core',
                rule_id: `CL-${group.id}01`,
                evidence: `"${match[0]}" without security review evidence`,
                required_fix: 'Provide security test log or security reasoning',
              }))
              trust_deductions += 20
            } else if (!hasEvidence && group.id === 'E') {
              // Group E: readiness at HIGH+ risk
              if (isHighPlus && isLowEvidence) {
                issues.push(makeIssue({
                  type: 'MISSING_EVIDENCE',
                  severity: 'HIGH',
                  layer: 'L3',
                  source: 'core',
                  rule_id: `CL-${group.id}01`,
                  evidence: `"${match[0]}" at ${risk_level} risk without supporting evidence`,
                  required_fix: 'Provide test evidence or reduce risk level before claiming readiness',
                }))
                trust_deductions += 20
              }
            }
          }

          // Non-blocking advisory note for 3+ matches at HIGH+ risk
          if (totalMatches >= 3 && isHighPlus) {
            advisory_notes.push(`Multiple overconfident patterns (${totalMatches}) at ${risk_level} risk — review claims carefully`)
          }
        }
      }
    }

    // Also keep CL401/CL402 for backward compatibility
    if (isLowEvidence && matched_groups.length > 0) {
      advisory_notes.push(`CL401: overconfident language without supporting evidence — consider qualifying or adding evidence`)
    }

    return { issues, trust_deductions, advisory_notes, matched_groups }
  }
}
