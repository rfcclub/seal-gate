import { describe, test, expect } from 'bun:test'
import { InputNormalizer } from '../src/engine/input-normalizer.ts'
import { SealInputError } from '../src/errors.ts'

describe('InputNormalizer', () => {
  const valid = {
    artifact_type: 'code_diff' as const,
    spec: null,
    output: 'Updated documentation for the module.',
    evidence: { test_log: '', build_log: '', diff: '', references: [] },
    risk_hint: null,
  }

  test('throws SealInputError when output is empty', () => {
    expect(() => InputNormalizer.normalize({ ...valid, output: '' })).toThrow(SealInputError)
  })

  test('throws SealInputError when output is whitespace', () => {
    expect(() => InputNormalizer.normalize({ ...valid, output: '   ' })).toThrow(SealInputError)
  })

  test('throws SealInputError when output is missing', () => {
    expect(() => InputNormalizer.normalize({ ...valid, output: undefined })).toThrow(SealInputError)
  })

  test('throws SealInputError for invalid artifact_type', () => {
    expect(() => InputNormalizer.normalize({ ...valid, artifact_type: 'invalid' as any })).toThrow(SealInputError)
  })

  test('normalizes valid input', () => {
    const result = InputNormalizer.normalize(valid)
    expect(result.artifact_type).toBe('code_diff')
    expect(result.output).toBe('Updated documentation for the module.')
    expect(result.spec).toBeNull()
    expect(result.evidence.references).toEqual([])
  })

  test('defaults missing evidence fields', () => {
    const result = InputNormalizer.normalize({ ...valid, evidence: undefined as any })
    expect(result.evidence.test_log).toBe('')
    expect(result.evidence.references).toEqual([])
  })
})
