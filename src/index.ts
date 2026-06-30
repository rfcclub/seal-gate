import { SealInput, SealVerdict, SealExtension, LLMReviewerAdapter, SealIssue, makeIssue, maxVerdict } from './types.ts'
import { TrustMemory } from './trust-memory.ts'
import { InputNormalizer } from './engine/input-normalizer.ts'
import { ClaimExtractor } from './detectors/claim-extractor.ts'
import { ArtifactClassifier } from './detectors/artifact-classifier.ts'
import { RiskClassifier } from './detectors/risk-classifier.ts'
import { EvidenceChecker } from './detectors/evidence-checker.ts'
import { EvidenceGapDetector } from './detectors/evidence-gap-detector.ts'
import { SpecCoverageDetector } from './detectors/spec-coverage-detector.ts'
import { TestWeaknessDetector } from './detectors/test-weakness-detector.ts'
import { ConfidenceLanguageDetector } from './detectors/confidence-language-detector.ts'
import { HeuristicScorer } from './engine/heuristic-scorer.ts'
import { PolicyEngine } from './engine/policy-engine.ts'
import { ExtensionRegistry } from './engine/extension-registry.ts'
import { VerdictFormatter } from './engine/verdict-formatter.ts'

const registry = new ExtensionRegistry()
let llmAdapter: LLMReviewerAdapter | null = null
let trustMemory: TrustMemory | null = null

export const Seal = {
  extend(ext: SealExtension): void {
    registry.add(ext)
  },

  withLLM(adapter: LLMReviewerAdapter): void {
    llmAdapter = adapter
  },

  withTrustMemory(mem: TrustMemory): void {
    trustMemory = mem
  },

  async review(rawInput: Partial<SealInput>): Promise<SealVerdict> {
    // Step 1: Normalize input
    const input = InputNormalizer.normalize(rawInput)

    // Step 2: Extract claims
    const claims = ClaimExtractor.extract(input.output)
    const usedSpans = ClaimExtractor.getUsedSpans(claims)

    // Step 3: Classify artifact
    const artifactCtx = ArtifactClassifier.classify(input.artifact_type)

    // Step 4: Classify risk
    const riskResult = RiskClassifier.classify({
      output: input.output,
      diff: input.evidence.diff,
      risk_hint: input.risk_hint,
    })

    // Step 5: Check evidence envelopes
    const evidenceResults = EvidenceChecker.check(input.evidence.references, { mode: 'portable' })

    // Collect evidence checker issues
    const evidenceIssues: SealIssue[] = []
    for (const result of evidenceResults) {
      if (!result.structurally_valid) {
        evidenceIssues.push(makeIssue({
          type: 'MISSING_EVIDENCE', severity: 'MEDIUM', layer: 'L3', source: 'core',
          evidence: `Malformed evidence envelope: ${result.mismatch_detail ?? 'invalid structure'}`,
        }))
      } else if (result.filesystem_verified === false) {
        evidenceIssues.push(makeIssue({
          type: 'MISSING_EVIDENCE', severity: 'HIGH', layer: 'L3', source: 'core',
          evidence: result.mismatch_detail ?? 'Evidence file could not be verified',
          required_fix: 'Fix evidence path or snapshot',
        }))
      }
    }

    // Step 6: Evidence gap detection
    const gapResult = EvidenceGapDetector.detect(claims, input.evidence, riskResult.risk_level)

    // Step 7: Spec coverage
    const specResult = SpecCoverageDetector.detect(input.spec, input.output)

    // Step 8: Test weakness detection
    const authFlagged = riskResult.matched_rules.includes('RK-HIGH')
    const testResult = TestWeaknessDetector.detect({
      artifact_type: input.artifact_type,
      output: input.output,
      risk_level: riskResult.risk_level,
      auth_flagged: authFlagged,
    }, input.evidence)

    // Step 9: Confidence language detection
    const confResult = ConfidenceLanguageDetector.detect({
      output: input.output,
      risk_level: riskResult.risk_level,
      evidence: input.evidence,
      deduped_spans: usedSpans,
    })

    // Collect all detector findings with their deductions
    const detectorFindings: SealIssue[] = [
      ...evidenceIssues,
      ...gapResult.issues,
      ...specResult.issues,
      ...testResult.issues,
      ...confResult.issues,
    ]

    // Collect advisory notes (do not affect score or verdict)
    const advisoryNotes: string[] = [...confResult.advisory_notes]

    // Add risk deduction as synthetic finding for HeuristicScorer
    const riskDeductionFindings = riskResult.trust_deduction > 0
      ? [{ trust_deduction: riskResult.trust_deduction } as SealIssue]
      : []

    // Evidence bonus: +5 per evidence field that passed EvidenceChecker validation, capped at +15.
    // Gated on validator pass — non-empty fields with invalid content do NOT earn a bonus.
    const evidenceFields = ['test_log', 'build_log', 'diff'] as const
    const validatedReferenceCount = evidenceResults.filter(r => r.structurally_valid && r.filesystem_verified !== false).length
    const fieldBonus = evidenceFields.filter(f => {
      const val = input.evidence[f]
      if (!val || typeof val !== 'string' || !val.trim()) return false
      // Field is non-empty AND does not contain failure signals
      const failPattern = /\b(FAIL|ERROR|failed|error:)\b/i
      return !failPattern.test(val)
    }).length * 5
    const referenceBonus = Math.min(validatedReferenceCount, 1) * 5 // max +5 for references
    const evidenceBonus = Math.min(fieldBonus + referenceBonus, 15)

    // Step 10: Compute detector_score (start from 100 + evidenceBonus, then deduct)
    const allDeductions = [
      ...detectorFindings.filter(f => (f.trust_deduction ?? 0) > 0),
      ...riskDeductionFindings,
    ]
    const detectorScore = Math.min(100, HeuristicScorer.computeDetectorScore(allDeductions) + evidenceBonus)

    // Step 11: Optional LLM reviewer
    let llmSignals = null
    let llmIssues: SealIssue[] = []
    const assumptions_detected = [...specResult.assumptions]

    if (llmAdapter) {
      const partialVerdict = {
        trust_score: detectorScore,
        risk_level: riskResult.risk_level,
        deterministic_findings: detectorFindings,
        missing_evidence: gapResult.missing_evidence,
        assumptions_detected,
      }
      try {
        llmSignals = await llmAdapter.review(input, partialVerdict)
        llmIssues = PolicyEngine.convertLLMSignals(llmSignals)
      } catch {
        detectorFindings.push(makeIssue({
          type: 'OTHER', severity: 'LOW', layer: 'L2', source: 'core',
          evidence: 'LLM reviewer failed — L2 unreviewed',
        }))
        assumptions_detected.push('L2 (semantic correctness) not reviewed — LLM reviewer error')
      }
    } else {
      assumptions_detected.push('L2 (semantic correctness) not reviewed — no LLM reviewer registered')
      detectorFindings.push(makeIssue({
        type: 'OTHER', severity: 'LOW', layer: 'L2', source: 'core',
        evidence: 'L2 unreviewed — semantic issues may exist',
      }))
    }

    // Step 12: Policy engine
    const baseVerdict = HeuristicScorer.toVerdict(detectorScore, detectorFindings.filter(f => f.is_blocking))
    const allFindingsForPolicy = [...detectorFindings, ...llmIssues]

    const policyResult = PolicyEngine.apply({
      base_verdict: baseVerdict,
      detector_score: detectorScore,
      risk_level: riskResult.risk_level,
      input,
      all_findings: allFindingsForPolicy,
      llm_signals: llmSignals,
    })

    // Combine all issues
    const allIssues = [...detectorFindings, ...policyResult.injected_issues]

    // Compute final trust score
    const finalScore = HeuristicScorer.computeFinalScore(detectorScore, policyResult.policy_deductions)

    // Final verdict — policy verdict wins if more severe
    let finalVerdict = maxVerdict(policyResult.verdict, HeuristicScorer.toVerdict(finalScore, allIssues.filter(i => i.is_blocking)))
    // BLOCK is terminal
    if (policyResult.verdict === 'BLOCK') finalVerdict = 'BLOCK'

    // Step 13: Extensions
    const extResult = registry.run(input)
    const extIssues = extResult.issues

    // Extension BLOCK check
    if (extIssues.some(i => i.is_blocking && i.required_verdict === 'BLOCK')) {
      finalVerdict = 'BLOCK'
    } else if (extIssues.some(i => i.is_blocking)) {
      finalVerdict = maxVerdict(finalVerdict, 'REVISE')
    }

    // Step 14a: Record to TrustMemory if wired and agent_id present
    const agentId = input.context?.agent_id
    if (trustMemory && agentId) {
      trustMemory.record(agentId, {
        verdict: finalVerdict,
        trust_score: finalScore,
        risk_level: riskResult.risk_level,
        blocking_count: [...allIssues, ...extIssues].filter(i => i.is_blocking).length,
      })
    }

    // Step 14b: Format verdict
    return VerdictFormatter.format({
      verdict: finalVerdict,
      trust_score: finalScore,
      risk_level: riskResult.risk_level,
      all_issues: [...allIssues, ...extIssues],
      llm_issues: llmIssues,
      missing_evidence: gapResult.missing_evidence,
      assumptions_detected,
      advisory_notes: advisoryNotes,
      trust_memory_summary: (trustMemory && agentId) ? trustMemory.getSummary(agentId) : undefined,
    })
  },
}

export type { SealInput, SealVerdict, SealExtension, LLMReviewerAdapter }
export { SealInputError } from './errors.ts'
