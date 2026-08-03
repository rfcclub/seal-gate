/**
 * plan_review mode pipeline — gates plans, designs, proposals, spec seeds.
 *
 * Core principle: no runtime exists, so behavioral claims are out of scope.
 * The gateable question is "is this coherent and complete against what was
 * locked before it was written?" Falsification, not approval.
 *
 * Pass threshold: 90 (higher than code mode's 85)
 * High-risk [71,89]: ESCALATE_TO_HUMAN instead of PASS_WITH_WARNINGS
 */

import {
  SealInput, SealVerdict, SealIssue, Verdict,
  gradeEvidence, maxVerdict, worstOf, makeIssue, SCHEMA_VERSION, NEXT_ACTION
} from '../types.js'
import type { ScoreBreakdown, FabricatedEvidence } from '../types.js'
import { VERSION } from '../version.js'
import { ClaimExtractor } from '../detectors/claim-extractor.js'
import { RiskClassifier } from '../detectors/risk-classifier.js'
import { SpecCoverageDetector } from '../detectors/spec-coverage-detector.js'
import { ContradictionDetector } from '../detectors/contradiction-detector.js'
import { CriteriaCoverageDetector } from '../detectors/criteria-coverage-detector.js'
import { OrphanClaimDetector } from '../detectors/orphan-claim-detector.js'
import { FalsificationDetector } from '../detectors/falsification-detector.js'
import { HeuristicScorer } from './heuristic-scorer.js'
import { PolicyEngine } from './policy-engine.js'
import { ExtensionRegistry } from './extension-registry.js'
import { TrustMemory } from '../trust-memory.js'

const PLAN_PASS_THRESHOLD = 90
const PLAN_ESCALATE_BAND_LOW = 71
const PLAN_ESCALATE_BAND_HIGH = 89

function planReviewVerdict(score: number, hasBlocking: boolean, riskLevel: string): Verdict {
  if (hasBlocking) return 'BLOCK'

  // High-risk middle band → ESCALATE instead of PASS_WITH_WARNINGS
  if (score >= PLAN_ESCALATE_BAND_LOW && score <= PLAN_ESCALATE_BAND_HIGH && riskLevel === 'HIGH') {
    return 'ESCALATE_TO_HUMAN'
  }

  if (score >= PLAN_PASS_THRESHOLD) return 'PASS'
  if (score >= PLAN_ESCALATE_BAND_LOW) return 'PASS_WITH_WARNINGS'
  if (score >= 50) return 'REVISE'
  if (score >= 30) return 'ESCALATE_TO_HUMAN'
  return 'BLOCK'
}

function evidenceBonus(issues: SealIssue[]): number {
  // +5 per confirmed-strong field (from CriteriaCoverageDetector), capped at +15
  const strongCount = issues
    .filter(i => gradeEvidence(i) === 'strong' && i.type !== 'LOGIC_BUG')
    .length
  return Math.min(strongCount * 5, 15)
}

export async function runPlanReviewPipeline(
  input: SealInput,
  registry: ExtensionRegistry,
  trustMemory: TrustMemory | null,
): Promise<SealVerdict> {
  const artifactFile = (input.context?.artifact_file as string) ?? 'artifact.md'

  // Step 1: Extract claims — behavioral claim patterns are designed for code artifacts,
  // not prose (words like "fixed", "fully" in specs are noise, not claims needing evidence).
  // OrphanClaimDetector in plan_review mode checks traceability anchors, not behavioral claims.
  const claims = input.artifact_type === 'plan_review' ? [] : ClaimExtractor.extract(input.output)

  // Step 2: Classify risk
  const riskResult = RiskClassifier.classify({
    output: input.output,
    diff: input.evidence?.diff ?? '',
    risk_hint: input.risk_hint,
  })

  // Step 3: Spec coverage (reused from code mode)
  const specResult = SpecCoverageDetector.detect(input.spec, input.output)
  const assumptions_detected = [...specResult.assumptions]

  // Stage 1 — ContradictionDetector (inline, keystone)
  const contradictionResult = ContradictionDetector.detect({
    artifact: input.output,
    artifact_file: artifactFile,
  })

  // Stage 2 — CriteriaCoverageDetector (inline)
  const lockedCriteria = input.context?.locked_criteria ?? []
  const coverageResult = CriteriaCoverageDetector.detect({
    artifact: input.output,
    artifact_file: artifactFile,
    locked_criteria: lockedCriteria as Array<{ id: string; text: string; source_file?: string; source_line?: number }>,
  })

  // Preflight failure: no locked criteria
  if (coverageResult.no_criteria_escalate) {
    assumptions_detected.push('No locked criteria — coverage measurement not possible')
  }

  // Stage 3 — OrphanClaimDetector (inline)
  const orphanResult = OrphanClaimDetector.detect(claims, input.output)

  // All deterministic findings
  const deterministicFindings: SealIssue[] = [
    ...contradictionResult.issues,
    ...coverageResult.issues,
    ...orphanResult.issues,
    ...specResult.issues,
  ]

  // Evidence bonus from covered criteria (confirmed-strong fields)
  const criteriaBonus = Math.min(coverageResult.confirmed_strong_fields * 5, 15)

  // Stage 4 — FalsificationDetector (parallel agent, async)
  const falsificationIssues = await FalsificationDetector.detect(input)

  // Score computation (start 100 + bonus, deduct per issue)
  const allDeductions = deterministicFindings.filter(f => (f.trust_deduction ?? 0) > 0)
  const falsificationDeductions = falsificationIssues
    .filter(f => (f.trust_deduction ?? 0) > 0)
    .reduce((sum, f) => sum + (f.trust_deduction ?? 0), 0)
  const baseScore = HeuristicScorer.computeDetectorScore(allDeductions)
  const detectorScore = Math.max(0, Math.min(100, baseScore + criteriaBonus - falsificationDeductions))

  // Policy engine (reused)
  const hasBlocking = deterministicFindings.some(f => f.is_blocking)
  const baseVerdict = planReviewVerdict(detectorScore, hasBlocking, riskResult.risk_level)

  const allForPolicy = [...deterministicFindings, ...falsificationIssues]
  const policyResult = PolicyEngine.apply({
    base_verdict: baseVerdict,
    detector_score: detectorScore,
    risk_level: riskResult.risk_level,
    input,
    all_findings: allForPolicy,
    llm_signals: null,
  })

  // Extensions
  const extResult = registry.run(input)

  // Combine all issues
  const allIssues = [...deterministicFindings, ...policyResult.injected_issues, ...falsificationIssues]

  // Final score
  const finalScore = HeuristicScorer.computeFinalScore(detectorScore, policyResult.policy_deductions)

  // Honor required_verdict on all findings (including non-blocking)
  const requiredVerdicts = allForPolicy
    .map(i => i.required_verdict)
    .filter((v): v is Verdict => !!v)

  // Final verdict
  let finalVerdict = worstOf(
    policyResult.verdict,
    planReviewVerdict(finalScore, allIssues.some(i => i.is_blocking), riskResult.risk_level),
  )
  for (const rv of requiredVerdicts) finalVerdict = worstOf(finalVerdict, rv)

  // Preflight escalation overrides
  if (coverageResult.no_criteria_escalate) {
    finalVerdict = worstOf(finalVerdict, 'ESCALATE_TO_HUMAN')
  }

  // Extension block check
  if (extResult.issues.some(i => i.is_blocking && i.required_verdict === 'BLOCK')) {
    finalVerdict = 'BLOCK'
  }

  const allIssuesFull = [...allIssues, ...extResult.issues]
  const blocking = allIssuesFull.filter(i => i.is_blocking)
  const nonBlocking = allIssuesFull.filter(i => !i.is_blocking)

  // TrustMemory
  const agentId = input.context?.agent_id
  if (trustMemory && agentId) {
    trustMemory.record(agentId, {
      verdict: finalVerdict,
      trust_score: finalScore,
      risk_level: riskResult.risk_level,
      blocking_count: blocking.length,
    })
  }

  return {
    verdict: finalVerdict,
    trust_score: finalScore,
    risk_level: riskResult.risk_level,
    summary: `plan_review: ${finalVerdict} (trust=${finalScore}, risk=${riskResult.risk_level}): ${blocking.length} blocking, ${nonBlocking.length} non-blocking`,
    deterministic_findings: allIssuesFull,
    llm_findings: falsificationIssues,
    blocking_issues: blocking,
    non_blocking_issues: nonBlocking,
    missing_evidence: [],
    assumptions_detected,
    advisory_notes: [],
    next_action: NEXT_ACTION[finalVerdict],
    version: VERSION,
    schema_version: SCHEMA_VERSION,
    score_breakdown: {
      base: 100,
      issue_deductions: blocking.reduce((s, i) => s + (i.trust_deduction ?? 0), 0) + nonBlocking.reduce((s, i) => s + (i.trust_deduction ?? 0), 0),
      missing_evidence_deductions: 0,
      risk_deductions: riskResult.trust_deduction,
      overconfidence_deductions: 0,
      evidence_bonuses: 0,
      final: finalScore,
    },
    fabricated_evidence: [],
    trust_memory_summary: (trustMemory && agentId) ? trustMemory.getSummary(agentId) : undefined,
  }
}
