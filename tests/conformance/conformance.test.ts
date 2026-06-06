import { describe, test, expect } from 'bun:test'
import { Seal } from '../../src/index.ts'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURES_DIR = join(import.meta.dir, 'fixtures')

interface Fixture {
  input: Parameters<typeof Seal.review>[0]
  expected: { verdict: string; trust_score: number; risk_level: string; blocking_count: number }
}

const fixtures = readdirSync(FIXTURES_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => ({ name: f.replace('.json', ''), data: JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf-8')) as Fixture }))

describe('Conformance — TypeScript golden fixtures', () => {
  for (const { name, data } of fixtures) {
    test(`${name}: verdict=${data.expected.verdict}, score=${data.expected.trust_score}`, async () => {
      const verdict = await Seal.review(data.input)
      expect(verdict.verdict).toBe(data.expected.verdict)
      expect(verdict.trust_score).toBe(data.expected.trust_score)
      expect(verdict.risk_level).toBe(data.expected.risk_level)
      expect(verdict.blocking_issues.length).toBe(data.expected.blocking_count)
    })
  }
})
