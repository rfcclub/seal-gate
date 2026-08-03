export type ArtifactType = 'llm_response' | 'code_diff' | 'test_plan' | 'design' | 'migration' | 'plan_review'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type Verdict = 'PASS' | 'PASS_WITH_WARNINGS' | 'REVISE' | 'ESCALATE_TO_HUMAN' | 'BLOCK'
export type IssueType = 'SPEC_MISMATCH' | 'LOGIC_BUG' | 'TEST_GAP' | 'MISSING_EVIDENCE' | 'SECURITY_RISK' | 'DATA_RISK' | 'HALLUCINATION' | 'AMBIGUITY' | 'COMPATIBILITY_RISK' | 'FABRICATED_EVIDENCE' | 'SPEC_UNTESTED' | 'OTHER'
export type IssueLayer = 'L1' | 'L2' | 'L3' | 'L4' | 'EXTENSION' | 'LLM_OVERLAY'
export type ClaimType = 'test_result_claim' | 'implementation_claim' | 'compatibility_claim' | 'risk_claim' | 'build_claim' | 'production_claim' | 'generic_claim'
export type CitationStatus = 'verified' | 'drifted' | 'void' | 'phantom' | 'not_applicable'
export type StructuralClaimType = 'structural_endpoint' | 'structural_auth' | 'structural_migration' | 'structural_dependency'

export type EvidenceEnvelope =
  | { type: 'file'; path: string; line: number; snapshot: string }
  | { type: 'command'; command: string; exit_code: number; output: string }
  | { type: 'url'; url: string; retrieved_at: string; content_snapshot: string }
  | { type: 'text'; label: string; content: string }
  | { type: 'memory'; memory_key: string; retrieved_at: string; content_snapshot: string }

export interface SealEvidence {
  test_log: string
  build_log: string
  diff: string
  references: EvidenceEnvelope[]
}

export interface SealInput {
  artifact_type: ArtifactType
  spec: string | null
  output: string
  evidence: SealEvidence
  risk_hint: RiskLevel | null
  context?: {
    agent_id?: string
    agent_role?: string
    aria_axioms?: string[]
    aria_pattern_memory?: Record<string, unknown>
    // plan_review mode: locked acceptance criteria from intent.md / self-check.md
    locked_criteria?: Array<{ id: string; text: string; source_file?: string; source_line?: number }>
    [key: string]: unknown
  }
}

export interface Claim {
  text: string
  type: ClaimType
  start_pos: number
  end_pos: number
  requires_evidence: boolean
}

export interface StructuralClaim {
  type: StructuralClaimType
  target: string          // e.g. "/api/login" for endpoint, "auth middleware" for auth, "package.json" for dep
  line: number
  description: string
  requires_auth?: boolean // for endpoint claims: does it have auth?
  has_rollback?: boolean  // for migration claims
  change_type?: 'added' | 'modified' | 'removed'
}

export interface EvidenceResult {
  envelope: EvidenceEnvelope
  structurally_valid: boolean
  filesystem_verified: boolean | null
  mismatch_detail?: string
  citation_status?: CitationStatus
}

export interface ScoreBreakdown {
  base: number
  issue_deductions: number
  missing_evidence_deductions: number
  risk_deductions: number
  overconfidence_deductions: number
  evidence_bonuses: number
  final: number
}

export interface FabricatedEvidence {
  type: IssueType
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

export interface SealIssue {
  type: IssueType
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  is_blocking: boolean
  required_verdict?: Verdict
  evidence: string
  required_fix?: string
  suggested_fix?: string
  layer: IssueLayer
  rule_id?: string
  source: 'core' | 'llm-overlay' | 'extension'
  trust_deduction?: number
  // plan_review mode — richer location fields
  evidence_file?: string
  evidence_lines?: number[]   // [lineA] for single, [lineA, lineB] for contradiction pair (Type G)
  evidence_quote?: string
  criterion_ref?: string      // for Type H (unsatisfied forward-criterion)
  confidence?: number
  policy_tags?: string[]
  // CitationVerifier annotation
  citation_status?: CitationStatus
}

export type EvidenceGrade = 'strong' | 'weak' | 'none'

export function gradeEvidence(issue: SealIssue): EvidenceGrade {
  const hasFile = !!issue.evidence_file
  const hasLines = !!(issue.evidence_lines && issue.evidence_lines.length > 0)
  const hasQuote = !!issue.evidence_quote
  const hasCriterionRef = !!issue.criterion_ref

  // Type G: contradiction pair — both line spans present
  const isTypeG = hasFile && hasLines && (issue.evidence_lines?.length ?? 0) >= 2 && hasQuote

  // Type H: unsatisfied forward-criterion with criterion_ref
  const isTypeH = hasCriterionRef && hasFile && hasLines

  // Type A+B: file + lines present
  const isAB = hasFile && hasLines

  // Type D: quote references spec requirement or AC bullet (heuristic: quote contains AC- or SHALL/MUST)
  const isTypeD = hasQuote && /\bAC-\d+\b|SHALL|MUST|SHOULD/i.test(issue.evidence_quote ?? '')

  if (isTypeG || isTypeH || isAB || isTypeD) return 'strong'

  // Type E: quote contains code/diff excerpt; Type F: AMBIGUITY issue type
  const isTypeE = hasQuote && /```|diff --git|@@/.test(issue.evidence_quote ?? '')
  const isTypeF = issue.type === 'AMBIGUITY'

  if (isTypeE || isTypeF) return 'weak'

  return 'none'
}

export interface LLMSignals {
  suspected_issues: string[]
  missing_requirements: string[]
  possible_edge_cases: string[]
  evidence_gaps: string[]
  risk_guess: RiskLevel
  confidence: number
}

export interface PartialVerdict {
  trust_score: number
  risk_level: RiskLevel
  deterministic_findings: SealIssue[]
  missing_evidence: string[]
  assumptions_detected: string[]
}

export interface TrustMemorySummary {
  agent_id: string
  reliability_score: number | null
  drift_trend: 'improving' | 'stable' | 'degrading'
  review_count: number
  last_reviewed_at: number | null
}

export interface SealVerdict {
  verdict: Verdict
  trust_score: number
  risk_level: RiskLevel
  summary: string
  deterministic_findings: SealIssue[]
  llm_findings: SealIssue[]
  blocking_issues: SealIssue[]
  non_blocking_issues: SealIssue[]
  missing_evidence: string[]
  assumptions_detected: string[]
  advisory_notes: string[]  // informational — do not affect verdict or score
  next_action: string
  version: string            // package version (e.g. "0.4.0")
  schema_version: string
  // New fields for reference gaps
  score_breakdown: ScoreBreakdown
  fabricated_evidence: FabricatedEvidence[]
  trust_memory_summary?: TrustMemorySummary  // present when context.agent_id is set and TrustMemory is wired
}

export interface SealExtension {
  name: string
  description: string
  check(input: SealInput): SealIssue[]
}

export interface LLMReviewerAdapter {
  review(input: SealInput, partial: PartialVerdict): Promise<LLMSignals> | LLMSignals
}

export const SCHEMA_VERSION = '0.2.0'

export const VERDICT_ORDER: Verdict[] = ['PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'ESCALATE_TO_HUMAN', 'BLOCK']

// Semantic worst-of comparison — safe against enum reordering because it reads VERDICT_ORDER, not integer values.
// Use this everywhere instead of arithmetic max over enum indices.
export function worstOf(a: Verdict, b: Verdict): Verdict {
  return VERDICT_ORDER.indexOf(a) >= VERDICT_ORDER.indexOf(b) ? a : b
}

// Alias for backward compatibility — prefer worstOf in new code
export const maxVerdict = worstOf

export function verdictFromScore(score: number, hasBlocking: boolean): Verdict {
  if (hasBlocking) return maxVerdict(scoreToVerdict(score), 'REVISE')
  return scoreToVerdict(score)
}

function scoreToVerdict(score: number): Verdict {
  if (score >= 85) return 'PASS'
  if (score >= 70) return 'PASS_WITH_WARNINGS'
  if (score >= 50) return 'REVISE'
  if (score >= 30) return 'ESCALATE_TO_HUMAN'
  return 'BLOCK'
}

export const NEXT_ACTION: Record<Verdict, string> = {
  PASS: 'Proceed',
  PASS_WITH_WARNINGS: 'Proceed with caution — review warnings',
  REVISE: 'Return to producing agent with blocking_issues',
  ESCALATE_TO_HUMAN: 'Halt — requires human review before continuing',
  BLOCK: 'Halt — do not proceed',
}

export function isBlocking(severity: SealIssue['severity']): boolean {
  return severity === 'CRITICAL' || severity === 'HIGH'
}

export function makeIssue(partial: Omit<SealIssue, 'is_blocking'>): SealIssue {
  return { ...partial, is_blocking: isBlocking(partial.severity) }
}
