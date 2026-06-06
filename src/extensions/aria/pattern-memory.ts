import { AriaIssueType } from './aria-issue-types.ts'
import { SealIssue } from '../../types.ts'
import { Verdict } from '../../types.ts'

const SEVERITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
const VERDICT_ORDER: Verdict[] = ['PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'ESCALATE_TO_HUMAN', 'BLOCK']
const WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
const RECURRENCE_THRESHOLD = 3

export interface PatternEntry {
  timestamps: number[]  // ISO timestamps of each occurrence within window
  examples: string[]
}

export type PatternMemory = Record<string, Partial<Record<AriaIssueType, PatternEntry>>>

/**
 * Update memory in-place for a given agent_role + aria_type occurrence.
 * Prunes timestamps older than the window before adding the new one.
 * Returns count of occurrences within the current window.
 */
export function recordOccurrence(
  memory: PatternMemory,
  agent_role: string,
  aria_type: AriaIssueType,
  example: string,
): number {
  if (!memory[agent_role]) memory[agent_role] = {}
  const agentMemory = memory[agent_role]!
  const now = Date.now()

  const existing = agentMemory[aria_type]
  if (existing && Array.isArray(existing.timestamps)) {
    // Prune timestamps outside window
    existing.timestamps = existing.timestamps.filter(t => now - t < WINDOW_MS)
    existing.timestamps.push(now)
    existing.examples = [...existing.examples.slice(-2), example]
  } else {
    // Initialize fresh (handles missing or old-format entries)
    agentMemory[aria_type] = { timestamps: [now], examples: [example] }
  }

  return agentMemory[aria_type]!.timestamps.length
}

/**
 * Get current count within rolling window (without updating).
 */
export function getCount(memory: PatternMemory | undefined, agent_role: string, aria_type: AriaIssueType): number {
  const entry = memory?.[agent_role]?.[aria_type]
  if (!entry || !Array.isArray(entry.timestamps)) return 0
  const now = Date.now()
  return entry.timestamps.filter(t => now - t < WINDOW_MS).length
}

/**
 * Apply ARIA-RECUR-001 escalation if count >= RECURRENCE_THRESHOLD.
 * Uses the original aria_type (not the potentially mutated rule_id).
 */
export function applyRecurrenceEscalation(
  issue: SealIssue,
  aria_type: AriaIssueType,
  count: number,
): SealIssue {
  if (count < RECURRENCE_THRESHOLD) return issue

  const sevIdx = SEVERITY_ORDER.indexOf(issue.severity as any)
  const newSev = SEVERITY_ORDER[Math.min(sevIdx + 1, SEVERITY_ORDER.length - 1)]

  const verdIdx = issue.required_verdict
    ? VERDICT_ORDER.indexOf(issue.required_verdict)
    : VERDICT_ORDER.indexOf('REVISE')
  const newVerdict = VERDICT_ORDER[Math.min(verdIdx + 1, VERDICT_ORDER.length - 1)]

  // Preserve original rule_id separately — append RECUR tag without replacing base ID
  const baseRuleId = issue.rule_id?.replace(/\+ARIA-RECUR-001$/, '') ?? 'ARIA-UNKNOWN'

  return {
    ...issue,
    severity: newSev as SealIssue['severity'],
    is_blocking: newSev === 'CRITICAL' || newSev === 'HIGH',
    required_verdict: newVerdict,
    rule_id: `${baseRuleId}+ARIA-RECUR-001`,
    evidence: `${issue.evidence} [Recurrent pattern: ${count}× within 24h window]`,
  }
}
