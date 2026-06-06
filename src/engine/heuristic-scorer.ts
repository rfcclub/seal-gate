import { SealIssue, Verdict, verdictFromScore } from '../types.ts'

export class HeuristicScorer {
  static computeDetectorScore(findings: Array<{ trust_deduction?: number }>): number {
    const total = findings.reduce((sum, f) => sum + (f.trust_deduction ?? 0), 0)
    return Math.max(0, Math.min(100, Math.floor(100 - total)))
  }

  static computeFinalScore(detectorScore: number, policyDeductions: number): number {
    return Math.max(0, Math.min(100, Math.floor(detectorScore - policyDeductions)))
  }

  static toVerdict(score: number, blockingIssues: SealIssue[]): Verdict {
    return verdictFromScore(score, blockingIssues.length > 0)
  }
}
