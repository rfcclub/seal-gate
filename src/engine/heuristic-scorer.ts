import { SealIssue, Verdict, verdictFromScore } from '../types.js'

// Below this, the deterministic layer isn't confident enough to call it a clean PASS on its
// own (matches scoreToVerdict's PASS threshold in types.ts) — used by `--llm auto` (AD-5) to
// decide whether escalating to the LLM reviewer is worth it. Conservative on purpose: escalate
// more readily rather than less (openspec/changes/verifiable-gate-hardening/intent.md Risks).
export const AMBIGUOUS_THRESHOLD = 85

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

  static isAmbiguous(score: number): boolean {
    return score < AMBIGUOUS_THRESHOLD
  }
}
