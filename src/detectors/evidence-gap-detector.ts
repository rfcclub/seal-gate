import { Claim, SealEvidence, SealIssue, EvidenceEnvelope } from '../types.ts'
import { makeIssue } from '../types.ts'

function hasMemoryEnvelope(references: EvidenceEnvelope[]): boolean {
  return references.some(r => r.type === 'memory' || (r.type === 'text' && ('label' in r) && /alaya|retrieved/i.test(r.label)))
}

export interface EvidenceGapResult {
  issues: SealIssue[]
  missing_evidence: string[]
  trust_deductions: number
}

const RISK_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export class EvidenceGapDetector {
  static detect(claims: Claim[], evidence: SealEvidence, risk_level = 'MEDIUM'): EvidenceGapResult {
    const issues: SealIssue[] = []
    const missing_evidence: string[] = []
    let trust_deductions = 0

    for (const claim of claims) {
      if (claim.type === 'test_result_claim') {
        const hasLog = evidence.test_log.trim().length > 0
        const hasCommandEvidence = evidence.references.some(r =>
          r.type === 'command' && /test|spec|jest|vitest|pytest/i.test(r.command)
        )
        if (!hasLog && !hasCommandEvidence) {
          issues.push(makeIssue({
            type: 'MISSING_EVIDENCE', severity: 'HIGH', layer: 'L3', source: 'core',
            rule_id: 'E001', trust_deduction: 20,
            evidence: `No test log for claim: "${claim.text}"`,
            required_fix: 'Provide test_log or command evidence envelope with test output',
          }))
          missing_evidence.push(`test_log required for: ${claim.text}`)
          trust_deductions += 20
        }
      }

      if (claim.type === 'build_claim') {
        const hasLog = evidence.build_log.trim().length > 0
        const hasCommandEvidence = evidence.references.some(r =>
          r.type === 'command' && /build|compile|make|gradle|maven|tsc/i.test(r.command)
        )
        if (!hasLog && !hasCommandEvidence) {
          issues.push(makeIssue({
            type: 'MISSING_EVIDENCE', severity: 'MEDIUM', layer: 'L3', source: 'core',
            rule_id: 'E002', trust_deduction: 15,
            evidence: `No build log for claim: "${claim.text}"`,
            suggested_fix: 'Provide build_log or command evidence envelope with build output',
          }))
          trust_deductions += 15
        }
      }

      if (claim.type === 'risk_claim') {
        const hasSecurityEvidence = evidence.test_log.trim().length > 0 &&
          /security|auth|unauthorized|pentest|vuln/i.test(evidence.test_log)
        const hasRefEvidence = evidence.references.some(r =>
          r.type === 'text' && /security/i.test('label' in r ? r.label : '')
        )
        if (!hasSecurityEvidence && !hasRefEvidence) {
          issues.push(makeIssue({
            type: 'MISSING_EVIDENCE', severity: 'HIGH', layer: 'L3', source: 'core',
            rule_id: 'E003', trust_deduction: 20,
            evidence: `No security reasoning for claim: "${claim.text}"`,
            required_fix: 'Provide security test log or security-reasoning text envelope',
          }))
          trust_deductions += 20
        }
      }

      if (claim.type === 'production_claim' && RISK_ORDER.indexOf(risk_level) >= RISK_ORDER.indexOf('MEDIUM')) {
        const hasAnyEvidence = evidence.references.length > 0 || evidence.test_log.trim().length > 0
        if (!hasAnyEvidence) {
          issues.push(makeIssue({
            type: 'MISSING_EVIDENCE', severity: 'CRITICAL', layer: 'L3', source: 'core',
            rule_id: 'E004', trust_deduction: 20,
            evidence: `No evidence for production-readiness claim: "${claim.text}"`,
            required_fix: 'Provide evidence envelopes demonstrating production readiness',
          }))
          missing_evidence.push(`production evidence required for: ${claim.text}`)
          trust_deductions += 20
        }
      }
    }

    return { issues, missing_evidence, trust_deductions }
  }
}
