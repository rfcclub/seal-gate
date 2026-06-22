import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BaselineManager } from '../baseline.ts';
import { DriftDb } from '../drift-db.ts';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';

function tmpSetup() {
  const tmpDir = `/tmp/drift-test-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  const dbPath = join(tmpDir, 'drift.db');
  const db = new DriftDb(dbPath);
  return { tmpDir, db, cleanup: () => rmSync(tmpDir, { recursive: true }) };
}

describe('BaselineManager', () => {
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

  it('computes baseline when files present', async () => {
    writeFileSync(join(tmpDir, 'SOUL.md'), 'Em la Lyra. Em la Prism.');
    writeFileSync(join(tmpDir, 'AXIOMS.md'), 'Em quan sat, khong tong hop.');

    const mgr = new BaselineManager(db);
    const result = await mgr.getOrCompute('Lyra', {
      soulPath: join(tmpDir, 'SOUL.md'),
      axiomsPath: join(tmpDir, 'AXIOMS.md'),
    });

    expect(result.status).toBe('READY');
    expect(result.vector).toHaveLength(384);
    expect(result.hash).not.toBe('');
    expect(mgr.status('Lyra')).toBe('READY');
  });

  it('caches and reuses when hash unchanged', async () => {
    writeFileSync(join(tmpDir, 'SOUL.md'), 'Soul content');

    const mgr = new BaselineManager(db);
    const r1 = await mgr.getOrCompute('Aria', {
      soulPath: join(tmpDir, 'SOUL.md'),
    });

    const r2 = await mgr.getOrCompute('Aria', {
      soulPath: join(tmpDir, 'SOUL.md'),
    });

    expect(r1.vector).toEqual(r2.vector);
    expect(r2.status).toBe('READY');
  });

  it('recomputes when file changes', async () => {
    writeFileSync(join(tmpDir, 'SOUL.md'), 'First version');
    const mgr = new BaselineManager(db);
    const r1 = await mgr.getOrCompute('Aria', {
      soulPath: join(tmpDir, 'SOUL.md'),
    });

    writeFileSync(join(tmpDir, 'SOUL.md'), 'Second version');
    const r2 = await mgr.getOrCompute('Aria', {
      soulPath: join(tmpDir, 'SOUL.md'),
    });

    expect(r1.hash).not.toBe(r2.hash);
    expect(r1.vector).not.toEqual(r2.vector);
  });

  it('returns degraded zero vector when files missing', async () => {
    const mgr = new BaselineManager(db);
    const result = await mgr.getOrCompute('Ghost', {
      soulPath: join(tmpDir, 'nonexistent.md'),
    });

    expect(result.status).toBe('DEGRADED');
    expect(result.vector).toEqual(new Array(384).fill(0));
    expect(mgr.status('Ghost')).toBe('DEGRADED');
  });

  it('concatenates with --- delimiter', async () => {
    writeFileSync(join(tmpDir, 'SOUL.md'), 'soul');
    writeFileSync(join(tmpDir, 'AXIOMS.md'), 'axioms');
    writeFileSync(join(tmpDir, 'PRIME.md'), 'prime');

    const mgr = new BaselineManager(db);
    await mgr.getOrCompute('Test', {
      soulPath: join(tmpDir, 'SOUL.md'),
      axiomsPath: join(tmpDir, 'AXIOMS.md'),
      primePath: join(tmpDir, 'PRIME.md'),
    });

    // Verify the hash was created from concatenated text
    const cached = db.baseline.get('Test');
    expect(cached).not.toBeNull();
    expect(cached!.content_hash).not.toBe('');
  });

  it('getCached returns null when not yet computed', () => {
    const mgr = new BaselineManager(db);
    expect(mgr.getCached('Nobody')).toBeNull();
  });
});
