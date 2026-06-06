export type ArtifactType = 'llm_response' | 'code_diff' | 'test_plan' | 'design' | 'migration'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type Verdict = 'PASS' | 'PASS_WITH_WARNINGS' | 'REVISE' | 'ESCALATE_TO_HUMAN' | 'BLOCK'
export type IssueType = 'SPEC_MISMATCH' | 'LOGIC_BUG' | 'TEST_GAP' | 'MISSING_EVIDENCE' | 'SECURITY_RISK' | 'DATA_RISK' | 'HALLUCINATION' | 'AMBIGUITY' | 'OTHER'
export type IssueLayer = 'L1' | 'L2' | 'L3' | 'L4' | 'EXTENSION' | 'LLM_OVERLAY'
export type ClaimType = 'test_result_claim' | 'implementation_claim' | 'compatibility_claim' | 'risk_claim' | 'build_claim' | 'production_claim' | 'generic_claim'

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
  context?: { agent_role?: string; aria_axioms?: string[]; aria_pattern_memory?: Record<string, unknown>; [key: string]: unknown }
}

export interface Claim {
  text: string
  type: ClaimType
  start_pos: number
  end_pos: number
  requires_evidence: boolean
}

export interface EvidenceResult {
  envelope: EvidenceEnvelope
  structurally_valid: boolean
  filesystem_verified: boolean | null
  mismatch_detail?: string
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
  next_action: string
  schema_version: string
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

export function maxVerdict(a: Verdict, b: Verdict): Verdict {
  return VERDICT_ORDER.indexOf(a) >= VERDICT_ORDER.indexOf(b) ? a : b
}

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
