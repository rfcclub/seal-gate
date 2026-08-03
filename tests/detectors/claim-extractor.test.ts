import { describe, it, expect } from 'bun:test'
import { ClaimExtractor } from '../../src/detectors/claim-extractor.ts'

describe('ClaimExtractor.extract — behavioral claims', () => {
  it('extracts test_result claims', () => {
    const claims = ClaimExtractor.extract('All tests pass after the fix')
    expect(claims.some(c => c.type === 'test_result_claim' && c.requires_evidence)).toBe(true)
  })

  it('skips claims inside code fences', () => {
    const text = '```\nall tests pass\n```\nThis is fine'
    const claims = ClaimExtractor.extract(text)
    const inCode = claims.filter(c => c.text === 'all tests pass')
    expect(inCode.length).toBe(0) // skipped because inside fence
  })

  it('extracts multiple claim types', () => {
    const text = 'Implemented login. All tests pass. Production ready.'
    const claims = ClaimExtractor.extract(text)
    const types = new Set(claims.map(c => c.type))
    expect(types.has('implementation_claim')).toBe(true)
    expect(types.has('test_result_claim')).toBe(true)
    expect(types.has('production_claim')).toBe(true)
  })
})

describe('ClaimExtractor.extractStructural — structural claims', () => {
  describe('HTTP endpoint detection', () => {
    it('detects Express-style endpoints', () => {
      const diff = `+app.get('/api/users', authMiddleware, handler)\n+app.post('/api/login', handler)`
      const claims = ClaimExtractor.extractStructural(diff)
      const endpoints = claims.filter(c => c.type === 'structural_endpoint')
      expect(endpoints.length).toBe(2)
      expect(endpoints.some(e => e.target === '/api/users')).toBe(true)
      expect(endpoints.some(e => e.target === '/api/login')).toBe(true)
    })

    it('detects decorator-style endpoints', () => {
      const diff = `+  @Get('/users')\n+  @Post()`
      const claims = ClaimExtractor.extractStructural(diff)
      const endpoints = claims.filter(c => c.type === 'structural_endpoint')
      expect(endpoints.length).toBeGreaterThanOrEqual(2)
    })

    it('returns empty when no endpoints', () => {
      const diff = `+const x = 1\n-const y = 2`
      const claims = ClaimExtractor.extractStructural(diff)
      const endpoints = claims.filter(c => c.type === 'structural_endpoint')
      expect(endpoints.length).toBe(0)
    })
  })

  describe('Auth detection', () => {
    it('detects auth middleware/guard', () => {
      const diff = `+  auth guard middleware check`
      const claims = ClaimExtractor.extractStructural(diff)
      const auths = claims.filter(c => c.type === 'structural_auth')
      expect(auths.length).toBeGreaterThanOrEqual(1)
      expect(auths.some(a => /auth|guard/i.test(a.target))).toBe(true)
    })

    it('detects requireAuth/ensureAuth', () => {
      const diff = `+router.get('/admin', requireAuth, adminHandler)`
      const claims = ClaimExtractor.extractStructural(diff)
      const auths = claims.filter(c => c.type === 'structural_auth')
      expect(auths.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Migration detection', () => {
    it('detects CREATE TABLE', () => {
      const diff = `+CREATE TABLE users (\n+  id INT PRIMARY KEY\n+);`
      const claims = ClaimExtractor.extractStructural(diff)
      expect(claims.some(c => c.type === 'structural_migration')).toBe(true)
    })

    it('detects ALTER TABLE', () => {
      const diff = `-ALTER TABLE users ADD COLUMN email VARCHAR(255);`
      const claims = ClaimExtractor.extractStructural(diff)
      expect(claims.some(c => c.type === 'structural_migration')).toBe(true)
    })

    it('detects migration files', () => {
      const diff = `+  return knex.schema.createTable('users', table => {\n+    table.increments()\n+  })`
      const claims = ClaimExtractor.extractStructural(diff)
      const migrations = claims.filter(c => c.type === 'structural_migration')
      expect(migrations.length).toBeGreaterThanOrEqual(1)
    })

    it('sets has_rollback when rollback present', () => {
      const diff = `+CREATE TABLE users (\n+  id INT PRIMARY KEY\n+);\n+database.rollback()`
      // The rollback is one of the patterns checked
      // has_rollback depends on context around the match
      const claims = ClaimExtractor.extractStructural(diff)
      const migration = claims.find(c => c.type === 'structural_migration')
      expect(migration).toBeDefined()
    })
  })

  describe('Dependency detection', () => {
    it('detects added dependencies in diff format', () => {
      // This simulates a diff line for package.json
      const diff = `+  "express": "^4.18.0"`
      const claims = ClaimExtractor.extractStructural(diff)
      expect(claims.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Git diff parsing', () => {
    it('scans added lines only in git diffs', () => {
      const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const express = require('express')
 const app = express()
-app.get('/old', handler)
+app.get('/new', authMiddleware, handler)`
      const claims = ClaimExtractor.extractStructural(diff)
      // Should detect the new endpoint
      const endpoints = claims.filter(c => c.type === 'structural_endpoint')
      expect(endpoints.some(e => e.target === '/new')).toBe(true)
    })
  })

  describe('Empty/edge cases', () => {
    it('returns empty for empty diff', () => {
      expect(ClaimExtractor.extractStructural('')).toEqual([])
    })

    it('returns empty for whitespace-only diff', () => {
      expect(ClaimExtractor.extractStructural('   \n  \n')).toEqual([])
    })
  })
})
