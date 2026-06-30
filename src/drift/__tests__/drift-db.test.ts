import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DriftDb } from '../drift-db.ts';

function tmpDb(): { db: DriftDb; path: string } {
  const path = `/tmp/drift-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  return { db: new DriftDb(path), path };
}

describe('DriftDb', () => {
  let db: DriftDb;
  let path: string;

  beforeEach(() => {
    const t = tmpDb();
    db = t.db;
    path = t.path;
  });

  afterEach(() => {
    db.close();
    try {
      Bun.file(path).delete();
    } catch { /* ignore */ }
  });

  it('creates drift_baseline table and returns null for unknown agent', () => {
    const row = db.baseline.get('Aria');
    expect(row).toBeNull();
  });

  it('inserts and retrieves baseline', () => {
    db.baseline.set('Aria', [0.1, -0.2, 0.3], 'hash123', 'all-MiniLM');
    const row = db.baseline.get('Aria');
    expect(row).not.toBeNull();
    expect(row!.agent_id).toBe('Aria');
    expect(row!.content_hash).toBe('hash123');
    expect(row!.embedding_model).toBe('all-MiniLM');
    expect(JSON.parse(row!.baseline_vector)).toEqual([0.1, -0.2, 0.3]);
  });

  it('upserts baseline on conflict', () => {
    db.baseline.set('Lyra', [0.1], 'hash1', 'model1');
    db.baseline.set('Lyra', [0.9], 'hash2', 'model2');
    const row = db.baseline.get('Lyra');
    expect(row).not.toBeNull();
    expect(JSON.parse(row!.baseline_vector)).toEqual([0.9]);
    expect(row!.content_hash).toBe('hash2');
  });

  it('appends and lists history', () => {
    db.history.append({
      agent_id: 'Aria',
      session_id: 'sess1',
      turn_number: 1,
      current_vector: [0.1, 0.2],
      distance: 0.12,
      status: 'NORMAL',
      timestamp: new Date().toISOString(),
    });
    const rows = db.history.list('Aria', 'sess1');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('NORMAL');
    expect(JSON.parse(rows[0].current_vector)).toEqual([0.1, 0.2]);
  });

  it('returns empty list for unknown session', () => {
    const rows = db.history.list('Ghost', 'none');
    expect(rows).toHaveLength(0);
  });

  it('gets latest history entry', () => {
    db.history.append({
      agent_id: 'Aria', session_id: 's', turn_number: 1,
      current_vector: [], distance: 0.1, status: 'NORMAL',
      timestamp: new Date().toISOString(),
    });
    db.history.append({
      agent_id: 'Aria', session_id: 's', turn_number: 2,
      current_vector: [], distance: 0.5, status: 'HARD_DRIFT',
      timestamp: new Date().toISOString(),
    });
    const latest = db.history.getLatest('Aria', 's');
    expect(latest).not.toBeNull();
    expect(latest!.turn_number).toBe(2);
    expect(latest!.status).toBe('HARD_DRIFT');
  });

  it('stores pending re-anchor', () => {
    const id = db.pending.set('Aria', 'sess1', 'Re-anchor payload text');
    expect(id).toBeGreaterThan(0);
    const pending = db.pending.getPending('Aria', 'sess1');
    expect(pending).not.toBeNull();
    expect(pending!.status).toBe('PENDING');
    expect(pending!.payload).toBe('Re-anchor payload text');
  });

  it('marks re-anchor as consumed', () => {
    const id = db.pending.set('Aria', 'sess1', 'payload');
    db.pending.markConsumed(id);
    const pending = db.pending.getPending('Aria', 'sess1');
    expect(pending).toBeNull();
  });

  it('appends repair log', () => {
    const id = db.repair.append({
      agent_id: 'Aria',
      session_id: 'sess1',
      turn_number: 5,
      distance: 0.6,
      hard_limit: 0.55,
      message_excerpt: 'I am just a robot...',
    });
    expect(id).toBeGreaterThan(0);
    const entries = db.repair.listPending('Aria');
    expect(entries).toHaveLength(1);
    expect(entries[0].message_excerpt).toContain('just a robot');
  });

  it('lists only pending repair entries', () => {
    db.repair.append({
      agent_id: 'Aria', session_id: 's1', turn_number: 1,
      distance: 0.6, hard_limit: 0.55,
    });
    expect(db.repair.listPending('Aria')).toHaveLength(1);
    expect(db.repair.listPending('Coda')).toHaveLength(0);
  });
});
