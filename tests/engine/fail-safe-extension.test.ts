import { describe, it, expect } from 'bun:test'
import { ExtensionRegistry } from '../../src/engine/extension-registry.ts'
import type { SealExtension, SealInput } from '../../src/types.ts'

// Extensions (aria, lyra, etc.) are optional add-ons run through ExtensionRegistry.run(),
// which wraps ext.check() in try/catch. A throwing extension degrades to a LOW/OTHER
// advisory finding rather than crashing the whole review or silently vanishing.
// Tested against a fresh ExtensionRegistry instance (not the Seal singleton) — Seal.extend()
// has no unregister, so registering through the public singleton would leak a
// permanently-throwing extension into every other test sharing this test run.
describe('fail-safe: extension throws', () => {
  it('degrades gracefully — extension failure is recorded as a finding, not silently dropped', () => {
    const registry = new ExtensionRegistry()
    const throwingExtension: SealExtension = {
      name: 'throwing-test-extension',
      description: 'always throws, for fail-safe regression testing',
      check() {
        throw new Error('extension boom')
      },
    }
    registry.add(throwingExtension)

    const input = {
      artifact_type: 'llm_response',
      output: 'All tests pass. Implemented the feature.',
      evidence: { diff: '', test_log: 'PASS', build_log: '', references: [] },
    } as unknown as SealInput

    const result = registry.run(input)

    expect(result.errors.some(e => e.includes('throwing-test-extension') && e.includes('extension boom'))).toBe(true)
    expect(result.issues.some(i => i.evidence.includes('throwing-test-extension'))).toBe(true)
  })
})
