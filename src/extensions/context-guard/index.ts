import { SealExtension, SealInput, SealIssue, makeIssue } from '../../types.ts'

/**
 * context-guard seal extension
 *
 * Reads context_guard metadata that the OpenClaw context-guard plugin embeds
 * in agent replies (via `before_agent_reply` short-circuit metadata). When
 * the plugin fired, the reply content is the clarifying question, not a
 * real answer — seal-gate should treat it as a low-confidence response and
 * either PASS_WITH_WARNINGS (single question, no destructive intent) or
 * REVISE (multi-question, looks like scope creep) — never escalate to
 * BLOCK on its own.
 *
 * This extension also surfaces any context_guard.confidence < threshold as
 * a spec-coverage-style issue for downstream scoring.
 */
export const contextGuardExtension: SealExtension = {
  name: 'context-guard',
  description: 'Flags replies produced under low context confidence by the OpenClaw context-guard plugin',

  check(input: SealInput): SealIssue[] {
    const ctx = input.context as
      | { context_guard?: { triggered?: boolean; confidence?: number; threshold?: number; questions?: number } }
      | undefined
    const guard = ctx?.context_guard
    if (!guard || guard.triggered !== true) return []

    const confidence = typeof guard.confidence === 'number' ? guard.confidence : 0
    const threshold = typeof guard.threshold === 'number' ? guard.threshold : 0.6
    const questions = typeof guard.questions === 'number' ? guard.questions : 0

    const issues: SealIssue[] = []

    // Confidence below threshold means the model was forced to ask instead of
    // answer. That's a spec-coverage gap, not a hard failure.
    if (confidence < threshold) {
      issues.push(makeIssue({
        type: 'AMBIGUITY',
        severity: 'MEDIUM',
        layer: 'EXTENSION',
        source: 'extension',
        rule_id: 'CG-LOW-CONFIDENCE',
        evidence: `context-guard fired with confidence=${confidence.toFixed(2)} < threshold=${threshold.toFixed(2)}`,
        required_fix: 'User input was ambiguous; agent responded with clarifying question instead of an answer',
        suggested_fix: 'User must provide more specific instructions before substantive work can proceed',
      }))
    }

    // Many clarifying questions in a row suggests the user is being grilled
    // — flag for review, but don't block.
    if (questions >= 3) {
      issues.push(makeIssue({
        type: 'OTHER',
        severity: 'LOW',
        layer: 'EXTENSION',
        source: 'extension',
        rule_id: 'CG-EXCESSIVE-QUESTIONS',
        evidence: `context-guard emitted ${questions} clarifying questions in a single turn`,
        required_fix: 'User reported being grilled too often; consider raising threshold or disabling guard',
      }))
    }

    return issues
  },
}
