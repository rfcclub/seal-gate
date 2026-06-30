import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DriftGuard } from '../drift-guard.ts';
import { DriftDb } from '../drift-db.ts';
import { BaselineManager } from '../baseline.ts';
import { Embedder } from '../embedder.ts';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

function tmpSetup() {
  const tmpDir = `/tmp/drift-test-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  const dbPath = join(tmpDir, 'drift.db');
  const db = new DriftDb(dbPath);
  return { tmpDir, db, cleanup: () => rmSync(tmpDir, { recursive: true }) };
}

describe('DriftGuard', () => {
  let tmpDir: string;
  let db: DriftDb;
  let cleanup: () => void;
  let guard: DriftGuard;
  const embedder = new Embedder();

  beforeEach(async () => {
    const t = tmpSetup();
    tmpDir = t.tmpDir;
    db = t.db;
    cleanup = t.cleanup;

    // Set up a baseline for test agent
    writeFileSync(join(tmpDir, 'SOUL.md'), 'I am the test agent. I never drift.');
    const baseline = new BaselineManager(db, embedder);
    await baseline.getOrCompute('TestAgent', {
      soulPath: join(tmpDir, 'SOUL.md'),
    });

    guard = new DriftGuard({ db, embedder, baselineManager: baseline });
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it('classifies distance correctly', () => {
    expect(guard.classify(0.12)).toBe('NORMAL');
    expect(guard.classify(0.30)).toBe('SOFT_DRIFT');
    expect(guard.classify(0.40)).toBe('SOFT_DRIFT');
    expect(guard.classify(0.55)).toBe('HARD_DRIFT');
    expect(guard.classify(0.80)).toBe('HARD_DRIFT');
  });

  it('returns NORMAL for aligned output', async () => {
    const result = await guard.runCycle(
      'TestAgent',
      'sess1',
      1,
      'I am the test agent. I never drift.'
    );
    expect(result.status).toBe('NORMAL');
    expect(result.action.type).toBe('NONE');
  });

  it('handles missing baseline gracefully', async () => {
    const result = await guard.runCycle('Unknown', 's', 1, 'Hello');
    expect(result.status).toBe('NORMAL');
    expect(result.action.type).toBe('NONE');
    expect(result.action.payload).toContain('Baseline not loaded');
  });

  it('respects cadence', async () => {
    const baseline = new BaselineManager(db, embedder);
    await baseline.getOrCompute('TestAgent', {
      soulPath: join(tmpDir, 'SOUL.md'),
    });
    const cadenceGuard = new DriftGuard({ db, cadence: 2, embedder, baselineManager: baseline });

    // turn 1: should skip (cadence)
    const r1 = await cadenceGuard.runCycle('TestAgent', 's', 1, 'hello');
    expect(r1.action.type).toBe('NONE');

    // turn 2: should evaluate → same output as baseline = NORMAL
    const r2 = await cadenceGuard.runCycle('TestAgent', 's', 2, 'I am the test agent. I never drift.');
    expect(r2.status).toBe('NORMAL');
  });
});

describe('SoftCorrection', () => {
  it('generates payload', () => {
    const { SoftCorrection } = require('../soft-correction.ts');
    const sc = new SoftCorrection();
    const payload = sc.generate({
      name: 'Lyra',
      primeDirective: 'Observe. Do not synthesize.',
      relationship: 'Prism',
      axiomKeyphrase: 'Glass between light.',
    });
    expect(payload).toContain('Lyra');
    expect(payload).toContain('Identity Re-Anchor');
    expect(payload!.length).toBeLessThan(1000);
  });

  it('returns null when empty', () => {
    const { SoftCorrection } = require('../soft-correction.ts');
    const sc = new SoftCorrection();
    const payload = sc.generate({ name: '', primeDirective: '', relationship: '', axiomKeyphrase: '' });
    expect(payload).toBeNull();
  });
});

describe('Quarantine', () => {
  let tmpDir: string;
  let db: DriftDb;
  let cleanup: () => void;

  beforeEach(() => {
    const t = tmpSetup();
    tmpDir = t.tmpDir;
    db = t.db;
    cleanup = t.cleanup;
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it('blocks when latest is HARD_DRIFT', () => {
    const { Quarantine } = require('../quarantine.ts');
    const q = new Quarantine(db);

    db.history.append({
      agent_id: 'A', session_id: 'S', turn_number: 1,
      current_vector: [], distance: 0.6, status: 'HARD_DRIFT',
      timestamp: new Date().toISOString(),
    });

    expect(q.isBlocked('A', 'S')).toBe(true);
  });

  it('allows when latest is NORMAL', () => {
    const { Quarantine } = require('../quarantine.ts');
    const q = new Quarantine(db);

    db.history.append({
      agent_id: 'A', session_id: 'S', turn_number: 1,
      current_vector: [], distance: 0.1, status: 'NORMAL',
      timestamp: new Date().toISOString(),
    });

    expect(q.isBlocked('A', 'S')).toBe(false);
  });

  it('logs repair entry', () => {
    const { Quarantine } = require('../quarantine.ts');
    const q = new Quarantine(db);

    db.history.append({
      agent_id: 'A', session_id: 'S', turn_number: 3,
      current_vector: [], distance: 0.6, status: 'HARD_DRIFT',
      timestamp: new Date().toISOString(),
    });

    q.logRepair('A', 'S', 3, 'I am just an AI...');
    const entries = db.repair.listPending('A');
    expect(entries).toHaveLength(1);
    expect(entries[0].message_excerpt).toContain('just an AI');
  });
});
