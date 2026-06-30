import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';

export interface DriftBaselineRow {
  agent_id: string;
  baseline_vector: string; // JSON array
  content_hash: string;
  embedding_model: string;
  created_at: string;
  updated_at: string;
}

export interface DriftHistoryRow {
  id: number;
  agent_id: string;
  session_id: string;
  turn_number: number;
  current_vector: string; // JSON array
  distance: number;
  status: string;
  re_anchor_id: number | null;
  timestamp: string;
}

export interface PendingReAnchorRow {
  id: number;
  agent_id: string;
  session_id: string;
  payload: string;
  created_at: string;
  status: 'PENDING' | 'CONSUMED' | 'EXPIRED';
  consumed_at: string | null;
}

export interface DriftRepairLogRow {
  id: number;
  agent_id: string;
  session_id: string;
  turn_number: number;
  distance: number;
  hard_limit: number;
  message_excerpt: string;
  triggered_at: string;
  human_review_flag: 'PENDING' | 'REVIEWED' | 'IGNORED';
  recovery_status: 'UNKNOWN' | 'RECOVERED' | 'PERSISTENT_DRIFT';
  notes: string | null;
}

export class DriftDb {
  private db: Database;

  constructor(dbPath?: string) {
    const path =
      dbPath ?? join(homedir(), '.seal', 'drift.db');
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS drift_baseline (
        agent_id TEXT PRIMARY KEY,
        baseline_vector TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS drift_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        current_vector TEXT,
        distance REAL,
        status TEXT NOT NULL,
        re_anchor_id INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_history_agent_session
        ON drift_history(agent_id, session_id);

      CREATE TABLE IF NOT EXISTS pending_re_anchor (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'PENDING',
        consumed_at DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_reanchor_pending
        ON pending_re_anchor(agent_id, session_id, status);

      CREATE TABLE IF NOT EXISTS drift_repair_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        distance REAL NOT NULL,
        hard_limit REAL NOT NULL,
        message_excerpt TEXT,
        triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        human_review_flag TEXT DEFAULT 'PENDING',
        recovery_status TEXT DEFAULT 'UNKNOWN',
        notes TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_repair_pending
        ON drift_repair_log(agent_id, human_review_flag);
    `);
  }

  // ── Baseline CRUD ────────────────────────────────────────────────

  baseline = {
    get: (agentId: string): DriftBaselineRow | null => {
      const stmt = this.db.query<
        DriftBaselineRow,
        [string]
      >('SELECT * FROM drift_baseline WHERE agent_id = ?');
      return stmt.get(agentId) ?? null;
    },

    set: (
      agentId: string,
      vector: number[],
      hash: string,
      model: string
    ): void => {
      const stmt = this.db.query(
        `INSERT INTO drift_baseline (agent_id, baseline_vector, content_hash, embedding_model)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET
           baseline_vector = excluded.baseline_vector,
           content_hash = excluded.content_hash,
           embedding_model = excluded.embedding_model,
           updated_at = CURRENT_TIMESTAMP`
      );
      stmt.run(agentId, JSON.stringify(vector), hash, model);
      stmt.finalize();
    },
  };

  // ── History CRUD ─────────────────────────────────────────────────

  history = {
    append: (row: {
      agent_id: string;
      session_id: string;
      turn_number: number;
      current_vector: number[];
      distance: number;
      status: string;
      timestamp: string;
    }): void => {
      const stmt = this.db.query(
        `INSERT INTO drift_history
         (agent_id, session_id, turn_number, current_vector, distance, status, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.run(
        row.agent_id,
        row.session_id,
        row.turn_number,
        JSON.stringify(row.current_vector),
        row.distance,
        row.status,
        row.timestamp
      );
      stmt.finalize();
    },

    list: (agentId: string, sessionId: string): DriftHistoryRow[] => {
      const stmt = this.db.query<
        DriftHistoryRow,
        [string, string]
      >(
        'SELECT * FROM drift_history WHERE agent_id = ? AND session_id = ? ORDER BY turn_number'
      );
      return stmt.all(agentId, sessionId);
    },

    getLatest: (agentId: string, sessionId: string): DriftHistoryRow | null => {
      const stmt = this.db.query<
        DriftHistoryRow,
        [string, string]
      >(
        `SELECT * FROM drift_history
         WHERE agent_id = ? AND session_id = ?
         ORDER BY turn_number DESC LIMIT 1`
      );
      return stmt.get(agentId, sessionId) ?? null;
    },
  };

  // ── Pending Re-Anchor CRUD ───────────────────────────────────────

  pending = {
    set: (agentId: string, sessionId: string, payload: string): number => {
      const stmt = this.db.query(
        `INSERT INTO pending_re_anchor (agent_id, session_id, payload, status)
         VALUES (?, ?, ?, 'PENDING')`
      );
      const result = stmt.run(agentId, sessionId, payload);
      stmt.finalize();
      return Number(result.lastInsertRowid);
    },

    getPending: (
      agentId: string,
      sessionId: string
    ): PendingReAnchorRow | null => {
      const stmt = this.db.query<
        PendingReAnchorRow,
        [string, string]
      >(
        `SELECT * FROM pending_re_anchor
         WHERE agent_id = ? AND session_id = ? AND status = 'PENDING'
         ORDER BY created_at DESC LIMIT 1`
      );
      return stmt.get(agentId, sessionId) ?? null;
    },

    markConsumed: (id: number): void => {
      const stmt = this.db.query(
        `UPDATE pending_re_anchor
         SET status = 'CONSUMED', consumed_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      );
      stmt.run(id);
      stmt.finalize();
    },
  };

  // ── Repair Log CRUD ──────────────────────────────────────────────

  repair = {
    append: (row: {
      agent_id: string;
      session_id: string;
      turn_number: number;
      distance: number;
      hard_limit: number;
      message_excerpt?: string;
    }): number => {
      const stmt = this.db.query(
        `INSERT INTO drift_repair_log
         (agent_id, session_id, turn_number, distance, hard_limit, message_excerpt)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const result = stmt.run(
        row.agent_id,
        row.session_id,
        row.turn_number,
        row.distance,
        row.hard_limit,
        row.message_excerpt ?? null
      );
      stmt.finalize();
      return Number(result.lastInsertRowid);
    },

    listPending: (agentId: string): DriftRepairLogRow[] => {
      const stmt = this.db.query<
        DriftRepairLogRow,
        [string]
      >(
        `SELECT * FROM drift_repair_log
         WHERE agent_id = ? AND human_review_flag = 'PENDING'
         ORDER BY triggered_at`
      );
      return stmt.all(agentId);
    },
  };

  close(): void {
    this.db.close();
  }
}
