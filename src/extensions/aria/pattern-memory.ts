import { AriaIssueType } from './aria-issue-types.ts'
import { SealIssue } from '../../types.ts'
import { Verdict } from '../../types.ts'

const SEVERITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
const VERDICT_ORDER: Verdict[] = ['PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'ESCALATE_TO_HUMAN', 'BLOCK']
const WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface PatternEntry {
  count: number
  last_seen: string
  examples: string[]
}

export type PatternMemory = Record<string, Record<AriaIssueType, PatternEntry>>

export function updateMemory(
  memory: PatternMemory | undefined,
  agent_role: string,
  aria_type: AriaIssueType,
  example: string
): PatternMemory {
  const m = memory ? JSON.parse(JSON.stringify(memory)) as PatternMemory : {}
  if (!m[agent_role]) m[agent_role] = {} as Record<AriaIssueType, PatternEntry>
  const existing = m[agent_role][aria_type]
  const now = new Date().toISOString()
  if (existing) {
    existing.count++
    existing.last_seen = now
    existing.examples = [...existing.examples.slice(-2), example]
  } else {
    m[agent_role][aria_type] = { count: 1, last_seen: now, examples: [example] }
  }
  return m
}

export function applyRecurrenceEscalation(issue: SealIssue, aria_type: AriaIssueType, memory: PatternMemory | undefined, agent_role: string): SealIssue {
  if (!memory?.[agent_role]?.[aria_type]) return issue
  const entry = memory[agent_role][aria_type]

  // Only count within rolling window
  const lastSeenMs = new Date(entry.last_seen).getTime()
  if (Date.now() - lastSeenMs > WINDOW_MS) return issue

  if (entry.count < 3) return issue

  // Escalate severity by one level
  const sevIdx = SEVERITY_ORDER.indexOf(issue.severity as any)
  const newSev = SEVERITY_ORDER[Math.min(sevIdx + 1, SEVERITY_ORDER.length - 1)]

  // Escalate required_verdict by one level
  const verdIdx = issue.required_verdict ? VERDICT_ORDER.indexOf(issue.required_verdict) : VERDICT_ORDER.indexOf('REVISE')
  const newVerdict = VERDICT_ORDER[Math.min(verdIdx + 1, VERDICT_ORDER.length - 1)]

  return {
    ...issue,
    severity: newSev as SealIssue['severity'],
    is_blocking: newSev === 'CRITICAL' || newSev === 'HIGH',
    required_verdict: newVerdict,
    rule_id: issue.rule_id ? `${issue.rule_id}+ARIA-RECUR-001` : 'ARIA-RECUR-001',
    evidence: `${issue.evidence} [Recurrent pattern: ${entry.count} occurrences]`,
  }
}
