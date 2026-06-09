import { describe, test, expect } from 'bun:test'
import { contextGuardExtension } from '../../src/extensions/context-guard/index.ts'
import { SealInput } from '../../src/types.ts'

const baseInput: SealInput = {
  artifact_type: 'llm_response',
  spec: null,
  output: 'Em chưa rõ ý anh, anh nói thêm được không?',
  evidence: { test_log: '', build_log: '', diff: '', references: [] },
  risk_hint: null,
}

describe('context-guard extension', () => {
  test('skipped when context_guard metadata absent', () => {
    const issues = contextGuardExtension.check({ ...baseInput, context: { agent_role: 'aria' } })
    expect(issues).toHaveLength(0)
  })

  test('skipped when context_guard.triggered is false', () => {
    const issues = contextGuardExtension.check({
      ...baseInput,
      context: { context_guard: { triggered: false, confidence: 0.9 } },
    })
    expect(issues).toHaveLength(0)
  })

  test('emits CG-LOW-CONFIDENCE when confidence < threshold', () => {
    const issues = contextGuardExtension.check({
      ...baseInput,
      context: { context_guard: { triggered: true, confidence: 0.3, threshold: 0.6 } },
    })
    const low = issues.find(i => i.rule_id === 'CG-LOW-CONFIDENCE')
    expect(low).toBeDefined()
    expect(low?.severity).toBe('MEDIUM')
    expect(low?.type).toBe('AMBIGUITY')
  })

  test('no CG-LOW-CONFIDENCE when confidence >= threshold', () => {
    const issues = contextGuardExtension.check({
      ...baseInput,
      context: { context_guard: { triggered: true, confidence: 0.85, threshold: 0.6 } },
    })
    expect(issues.filter(i => i.rule_id === 'CG-LOW-CONFIDENCE')).toHaveLength(0)
  })

  test('emits CG-EXCESSIVE-QUESTIONS when 3+ questions', () => {
    const issues = contextGuardExtension.check({
      ...baseInput,
      context: { context_guard: { triggered: true, confidence: 0.3, threshold: 0.6, questions: 4 } },
    })
    const excess = issues.find(i => i.rule_id === 'CG-EXCESSIVE-QUESTIONS')
    expect(excess).toBeDefined()
    expect(excess?.severity).toBe('LOW')
  })

  test('no CG-EXCESSIVE-QUESTIONS when 1-2 questions', () => {
    const issues = contextGuardExtension.check({
      ...baseInput,
      context: { context_guard: { triggered: true, confidence: 0.3, threshold: 0.6, questions: 2 } },
    })
    expect(issues.filter(i => i.rule_id === 'CG-EXCESSIVE-QUESTIONS')).toHaveLength(0)
  })

  test('combines low-confidence + excessive-questions correctly', () => {
    const issues = contextGuardExtension.check({
      ...baseInput,
      context: { context_guard: { triggered: true, confidence: 0.2, threshold: 0.6, questions: 5 } },
    })
    const ids = issues.map(i => i.rule_id).sort()
    expect(ids).toEqual(['CG-EXCESSIVE-QUESTIONS', 'CG-LOW-CONFIDENCE'])
  })

  test('missing confidence/threshold/questions → still fires low-confidence at default 0', () => {
    const issues = contextGuardExtension.check({
      ...baseInput,
      context: { context_guard: { triggered: true } },
    })
    const low = issues.find(i => i.rule_id === 'CG-LOW-CONFIDENCE')
    expect(low).toBeDefined()
    expect(low?.evidence).toContain('confidence=0.00')
  })
})
