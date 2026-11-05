import { describe, it, expect } from 'bun:test'
import { Seal } from '../../src/index.ts'

const diffWith = (context: string, removed = '  return slots.slice(1)') => `diff --git a/src/save.ts b/src/save.ts
index 1111111..2222222 100644
--- a/src/save.ts
+++ b/src/save.ts
@@ -10,7 +10,7 @@ export function exportSlots(slots) {
 ${context}
 export function exportSlots(slots) {
-${removed}
+  return slots.slice(0)
 }
`
const spec = '### Requirement: export\n#### Scenario: all slots\n- WHEN exporting\n- THEN every slot is included'
const review = (output: string, diff: string, test_log: string, regression?: unknown) =>
  Seal.review({
    artifact_type: 'code_diff', spec, output, risk_hint: null,
    evidence: { diff, test_log, build_log: '', references: [], ...(regression ? { regression } : {}) },
    context: { agent_id: 'gate-evidence-test', agent_role: 'developer' },
  } as Parameters<typeof Seal.review>[0])
const rules = (r: { blocking_issues: Array<{ rule_id?: string }> }) => r.blocking_issues.map(i => i.rule_id)
const record = (status: string, test_sha256 = 'a'.repeat(64)) =>
  ({ test: 'tests/save.test.ts', name: 'export includes every slot', status, test_sha256 })
const passingLog = 'tests/save.test.ts: 17 pass, 0 fail (invalid slot index rejected)'

describe('gate evidence heuristics', () => {
  it('context-line-admin: admin only in a context line does not escalate', async () => {
    const diff = diffWith('// admin users may export every save slot')
    const r = await review(diff, diff, passingLog)
    expect(rules(r)).not.toContain('TW205')
    expect(r.verdict).not.toBe('ESCALATE_TO_HUMAN')
  })

  it('context-line-fix: fix only in a context line does not raise TW203', async () => {
    const diff = diffWith('// fix the slot export later')
    const r = await review(diff, diff, passingLog)
    expect(rules(r)).not.toContain('TW203')
  })

  it('structured-regression: matching RED and GREEN records satisfy TW203', async () => {
    const diff = diffWith('// every slot is exported')
    const r = await review('fix: export includes the first slot\n' + diff, diff, passingLog,
      { red: [record('failed')], green: [record('passed')] })
    expect(rules(r)).not.toContain('TW203')
  })

  it('keyword-only: the word regression alone does not satisfy TW203', async () => {
    const diff = diffWith('// every slot is exported')
    const r = await review('fix: export includes the first slot\n' + diff, diff, passingLog + ' regression')
    const tw203 = r.blocking_issues.find(i => i.rule_id === 'TW203')
    expect(String(tw203?.evidence)).toContain('evidence.regression')
  })
})

// Preservation: these pass before and after the change.
describe('gate evidence heuristics preserved', () => {
  it('removed auth code still escalates', async () => {
    const diff = diffWith('// every slot is exported', '  admin.verify(user)')
    const r = await review(diff, diff, passingLog)
    expect(rules(r)).toContain('TW205')
  })

  it('mismatched RED and GREEN records do not satisfy TW203', async () => {
    const diff = diffWith('// every slot is exported')
    for (const regression of [
      { red: [record('failed')], green: [{ ...record('passed'), name: 'another test' }] },
      { red: [record('failed')], green: [record('passed', 'b'.repeat(64))] },
      { red: [record('passed')], green: [record('passed')] },
      { red: [record('failed', '')], green: [record('passed', '')] },
    ]) {
      const r = await review('fix: export includes the first slot\n' + diff, diff, passingLog, regression)
      expect(rules(r)).toContain('TW203')
    }
  })

  it('plain text without a diff is classified as before', async () => {
    const r = await review('fix the auth check', 'auth change', passingLog)
    expect(rules(r)).toEqual(expect.arrayContaining(['TW203', 'TW205']))
  })
})

describe('gate evidence heuristics review fixes', () => {
  it('auth-path: a change in an auth file escalates even when its lines have no auth word', async () => {
    const diff = `diff --git a/src/auth/check.ts b/src/auth/check.ts
index 1111111..2222222 100644
--- a/src/auth/check.ts
+++ b/src/auth/check.ts
@@ -1,3 +1,3 @@
 export function allowed(user) {
-  return !!user
+  return true
 }
`
    const r = await review(diff, diff, '1 pass')
    expect(rules(r)).toContain('TW205')
  })

  it('malformed-records: records without a test, a name or a SHA-256 do not satisfy TW203', async () => {
    const diff = diffWith('// every slot is exported')
    for (const regression of [
      { red: [{ status: 'failed', test_sha256: 'x' }], green: [{ status: 'passed', test_sha256: 'x' }] },
      { red: [{ ...record('failed'), test: '' }], green: [{ ...record('passed'), test: '' }] },
      { red: [{ ...record('failed'), name: '' }], green: [{ ...record('passed'), name: '' }] },
      { red: [record('failed', 'x')], green: [record('passed', 'x')] },
    ]) {
      const r = await review('fix: export includes the first slot\n' + diff, diff, passingLog, regression)
      expect(rules(r)).toContain('TW203')
    }
  })
})
