import { SealInput, SealVerdict, SealExtension, LLMReviewerAdapter, SealIssue, makeIssue, maxVerdict, ScoreBreakdown, FabricatedEvidence } from './types.js'
import { TrustMemory } from './trust-memory.js'
import { InputNormalizer } from './engine/input-normalizer.js'
import { ClaimExtractor } from './detectors/claim-extractor.js'
import { ArtifactClassifier } from './detectors/artifact-classifier.js'
import { RiskClassifier } from './detectors/risk-classifier.js'
import { EvidenceChecker } from './detectors/evidence-checker.js'
import { EvidenceGapDetector } from './detectors/evidence-gap-detector.js'
import { SpecCoverageDetector } from './detectors/spec-coverage-detector.js'
import { SpecCoverageValidator } from './detectors/spec-coverage-validator.js'
import { TestWeaknessDetector } from './detectors/test-weakness-detector.js'
import { ConfidenceLanguageDetector } from './detectors/confidence-language-detector.js'
import { HeuristicScorer } from './engine/heuristic-scorer.js'
import { PolicyEngine } from './engine/policy-engine.js'
import { ExtensionRegistry } from './engine/extension-registry.js'
import { VerdictFormatter } from './engine/verdict-formatter.js'
import { CitationVerifier, AbsencePattern } from './engine/citation-verifier.js'
import { runPlanReviewPipeline } from './engine/plan-review-pipeline.js'

const registry = new ExtensionRegistry()
let llmAdapter: LLMReviewerAdapter | null = null
let llmMode: 'always' | 'auto' = 'always'
let trustMemory: TrustMemory | null = null

export const Seal = {
  extend(ext: SealExtension): void {
    registry.add(ext)
  },

  // mode 'auto' (AD-5): only call the LLM reviewer when HeuristicScorer.isAmbiguous(detectorScore)
  // — additive, default ('always') behavior is unchanged.
  withLLM(adapter: LLMReviewerAdapter | null, opts?: { mode?: 'always' | 'auto' }): void {
    llmAdapter = adapter
    llmMode = opts?.mode ?? 'always'
  },

  withTrustMemory(mem: TrustMemory): void {
    trustMemory = mem
  },

  async review(rawInput: Partial<SealInput>): Promise<SealVerdict> {
    // Step 1: Normalize input
    const input = InputNormalizer.normalize(rawInput)

    // plan_review mode: dedicated 4-stage pipeline (unchanged)
    if (input.artifact_type === 'plan_review') {
      return runPlanReviewPipeline(input, registry, trustMemory)
    }

    // Step 1b: Capture pre-flight hash for pipeline integrity
    const preflightHash = CitationVerifier.computeHash(input.output + input.evidence.diff)

    // Step 2: Extract claims (behavioral + structural)
    const claims = ClaimExtractor.extract(input.output)
    const usedSpans = ClaimExtractor.getUsedSpans(claims)
    const structuralClaims = ClaimExtractor.extractStructural(input.evidence.diff)

    // Step 3: Classify artifact
    const artifactCtx = ArtifactClassifier.classify(input.artifact_type)

    // Step 4: Classify risk
    const riskResult = RiskClassifier.classify({
      output: input.output,
      diff: input.evidence.diff,
      risk_hint: input.risk_hint,
    })

    // Step 5: Check evidence envelopes (with citation verification)
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

    // Step 7: Spec coverage — use SpecCoverageValidator (Level 1) when test_log available
    // Falls back to SpecCoverageDetector (keyword-based) when no test_log for backward compat
    let specCoverageResult
    let specDetectorResult
    if (input.evidence.test_log.trim().length > 0) {
      specCoverageResult = SpecCoverageValidator.validate(input.spec, input.evidence.test_log, input.evidence.diff)
      specDetectorResult = { issues: [], assumptions: [] }
    } else {
      specCoverageResult = { issues: [], assumptions: [], trust_deductions: 0, coverage: [] }
      specDetectorResult = SpecCoverageDetector.detect(input.spec, input.output)
    }

    // Step 8: Test weakness detection
    const authFlagged = riskResult.matched_rules.includes('RK-HIGH')
    const testResult = TestWeaknessDetector.detect({
      artifact_type: input.artifact_type,
      output: input.output,
      risk_level: riskResult.risk_level,
      auth_flagged: authFlagged,
    }, input.evidence)

    // Step 9: Confidence language detection (now with structural claims)
    const confResult = ConfidenceLanguageDetector.detect({
      output: input.output,
      risk_level: riskResult.risk_level,
      evidence: input.evidence,
      deduped_spans: usedSpans,
      structural_claims: structuralClaims,
    })

    // Collect all detector findings
    const allDetectorFindings: SealIssue[] = [
      ...evidenceIssues,
      ...gapResult.issues,
      ...specDetectorResult.issues,
      ...specCoverageResult.issues,
      ...testResult.issues,
      ...confResult.issues,
    ]

    // Collect advisory notes
    const advisoryNotes: string[] = [...confResult.advisory_notes]

    // Step 9b: CitationVerifier — verify all detector findings that have citations
    const artifactContent = input.output
    const absencePatterns: AbsencePattern[] = [
      { positive: /\b(function|endpoint|route|app\.(get|post|put|delete|patch))\b/i, negated: /\b(auth|guard|middleware|@Authenticated|@Authorize|requireAuth)\b/i, label: 'auth' },
      { positive: /\b(migration|CREATE\s+TABLE|ALTER\s+TABLE|schema)\b/i, negated: /\b(rollback|revert|down\s+migration)\b/i, label: 'rollback' },
    ]

    const { issues: verifiedFindings, fabricated: fabricatedEvidence } = CitationVerifier.verifyIssues(
      allDetectorFindings,
      artifactContent,
      'artifact',  // logical file name for citation matching
      { absencePatterns },
    )

    // Step 9c: Pipeline integrity check
    const currentHash = CitationVerifier.computeHash(input.output + input.evidence.diff)
    const integrityPassed = CitationVerifier.checkIntegrity(preflightHash, currentHash)
    let pipelineIntegrityIssues: SealIssue[] = []
    if (!integrityPassed) {
      pipelineIntegrityIssues.push(makeIssue({
        type: 'OTHER',
        severity: 'CRITICAL',
        layer: 'L4',
        source: 'core',
        evidence: 'Pipeline integrity check failed — artifact changed mid-review',
        required_verdict: 'ESCALATE_TO_HUMAN',
        required_fix: 'Review the artifact again from scratch',
      }))
    }

    // Add risk deduction as synthetic finding for HeuristicScorer
    const riskDeductionFindings = riskResult.trust_deduction > 0
      ? [{ trust_deduction: riskResult.trust_deduction } as SealIssue]
      : []

    // Evidence bonus
    const evidenceFields = ['test_log', 'build_log', 'diff'] as const
    const validatedReferenceCount = evidenceResults.filter(r => r.structurally_valid && r.filesystem_verified !== false).length
    const fieldBonus = evidenceFields.filter(f => {
      const val = input.evidence[f]
      if (!val || typeof val !== 'string' || !val.trim()) return false
      const failPattern = /\b(FAIL|ERROR|failed|error:)\b/i
      return !failPattern.test(val)
    }).length * 5
    const referenceBonus = Math.min(validatedReferenceCount, 1) * 5
    const evidenceBonus = Math.min(fieldBonus + referenceBonus, 15)

    // Step 10: Compute detector score
    const allDeductions = [
      ...verifiedFindings.filter(f => (f.trust_deduction ?? 0) > 0),
      ...riskDeductionFindings,
      ...pipelineIntegrityIssues.filter(i => i.trust_deduction ?? 0 > 0),
    ]
    const detectorScore = Math.min(100, HeuristicScorer.computeDetectorScore(allDeductions) + evidenceBonus)

    // Step 11: Optional LLM reviewer
    let llmSignals = null
    let llmIssues: SealIssue[] = []
    const assumptions_detected = [...specCoverageResult.assumptions, ...specDetectorResult.assumptions]

    const shouldRunLLM = !!llmAdapter && (llmMode === 'always' || HeuristicScorer.isAmbiguous(detectorScore))

    if (shouldRunLLM) {
      const partialVerdict = {
        trust_score: detectorScore,
        risk_level: riskResult.risk_level,
        deterministic_findings: verifiedFindings,
        missing_evidence: gapResult.missing_evidence,
        assumptions_detected,
      }
      try {
        llmSignals = await llmAdapter!.review(input, partialVerdict)
        llmIssues = PolicyEngine.convertLLMSignals(llmSignals)
      } catch {
        verifiedFindings.push(makeIssue({
          type: 'OTHER', severity: 'LOW', layer: 'L2', source: 'core',
          evidence: 'LLM reviewer failed — L2 unreviewed',
        }))
        assumptions_detected.push('L2 (semantic correctness) not reviewed — LLM reviewer error')
      }
    } else if (llmAdapter && llmMode === 'auto') {
      // Auto mode: heuristic score was confident enough (not ambiguous) — skip the LLM
      // reviewer. This is an intentional skip, not a failure, so no synthetic L2 finding.
      assumptions_detected.push(`L2 (semantic correctness) skipped — heuristic score confident enough (auto mode, score=${detectorScore})`)
    } else {
      assumptions_detected.push('L2 (semantic correctness) not reviewed — no LLM reviewer registered')
      verifiedFindings.push(makeIssue({
        type: 'OTHER', severity: 'LOW', layer: 'L2', source: 'core',
        evidence: 'L2 unreviewed — semantic issues may exist',
      }))
    }

    // Step 12: Policy engine
    const baseVerdict = HeuristicScorer.toVerdict(detectorScore, verifiedFindings.filter(f => f.is_blocking))
    // fabricatedEvidence entries are included here (policy visibility only, not in allIssues below)
    // so PolicyEngine's FABRICATED_EVIDENCE rule can escalate — proving a citation false must
    // actually affect the verdict, not just appear in the fabricated_evidence report field.
    const allFindingsForPolicy = [...verifiedFindings, ...llmIssues, ...pipelineIntegrityIssues, ...(fabricatedEvidence as unknown as SealIssue[])]

    const policyResult = PolicyEngine.apply({
      base_verdict: baseVerdict,
      detector_score: detectorScore,
      risk_level: riskResult.risk_level,
      input,
      all_findings: allFindingsForPolicy,
      llm_signals: llmSignals,
    })

    // Combine all issues (excluding fabricated evidence which is tracked separately)
    const allIssues = [...verifiedFindings, ...policyResult.injected_issues, ...pipelineIntegrityIssues]

    // Compute final trust score
    const finalScore = HeuristicScorer.computeFinalScore(detectorScore, policyResult.policy_deductions)

    // Compute score_breakdown
    const issueDeductions = allIssues
      .filter(i => i.trust_deduction && i.trust_deduction > 0)
      .reduce((sum, i) => sum + (i.trust_deduction ?? 0), 0)
    const missingEvidenceDeductions = allIssues
      .filter(i => i.type === 'MISSING_EVIDENCE' && i.trust_deduction && i.trust_deduction > 0)
      .reduce((sum, i) => sum + (i.trust_deduction ?? 0), 0)
    const riskDeductionsTotal = riskResult.trust_deduction + policyResult.policy_deductions
    const overconfidenceDeductions = confResult.trust_deductions
    const score_breakdown: ScoreBreakdown = {
      base: 100,
      issue_deductions: issueDeductions,
      missing_evidence_deductions: missingEvidenceDeductions,
      risk_deductions: riskDeductionsTotal,
      overconfidence_deductions: overconfidenceDeductions,
      evidence_bonuses: evidenceBonus,
      final: Math.max(0, Math.min(100, 100 - issueDeductions - riskDeductionsTotal - overconfidenceDeductions + evidenceBonus)),
    }

    // Final verdict
    let finalVerdict = maxVerdict(policyResult.verdict, HeuristicScorer.toVerdict(finalScore, allIssues.filter(i => i.is_blocking)))
    if (policyResult.verdict === 'BLOCK') finalVerdict = 'BLOCK'
    if (!integrityPassed) finalVerdict = maxVerdict(finalVerdict, 'ESCALATE_TO_HUMAN')

    // Step 13: Extensions
    const extResult = registry.run(input)
    const extIssues = extResult.issues

    if (extIssues.some(i => i.is_blocking && i.required_verdict === 'BLOCK')) {
      finalVerdict = 'BLOCK'
    } else if (extIssues.some(i => i.is_blocking)) {
      finalVerdict = maxVerdict(finalVerdict, 'REVISE')
    }

    // Convert fabricated evidence entries to FabricatedEvidence type
    const fabricatedEvidenceFormatted: FabricatedEvidence[] = fabricatedEvidence.map(fe => ({
      type: 'FABRICATED_EVIDENCE' as any,
      severity: fe.severity as 'CRITICAL' | 'HIGH',
      is_blocking: false,
      evidence: fe.evidence,
      layer: 'L3' as any,
      source: 'core' as any,
      citation_status: fe.citation_status,
      fabricated_reason: fe.fabricated_reason,
      claimed_evidence: fe.claimed_evidence,
    }))

    // Step 14a: Record to TrustMemory
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
      score_breakdown,
      fabricated_evidence: fabricatedEvidenceFormatted,
      trust_memory_summary: (trustMemory && agentId) ? trustMemory.getSummary(agentId) : undefined,
    })
  },
}

export type { SealInput, SealVerdict, SealExtension, LLMReviewerAdapter }
export { VERSION } from './version.js'
export { TrustMemory } from './trust-memory.js'
export { createReviewer, createMinimaxReviewer, createFireworksReviewer, createGeminiReviewer, createMiMoReviewer, createLocalReviewer } from './adapters/generic-llm-reviewer.js'
export { SpecCoverageValidator } from './detectors/spec-coverage-validator.js'
export { checkTestPinsBehavior, breedMutations } from './spec/mutation-probe.js'
export { SealInputError } from './errors.js'
