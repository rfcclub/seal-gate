import { DriftDb } from './drift-db.js';

/**
 * Hard-drift quarantine: block memory promotion + log repair events.
 */
export class Quarantine {
  private db: DriftDb;

  constructor(db: DriftDb) {
    this.db = db;
  }

  /**
   * Check if the latest turn for this session was HARD_DRIFT.
   */
  isBlocked(agentId: string, sessionId: string): boolean {
    const latest = this.db.history.getLatest(agentId, sessionId);
    return latest?.status === 'HARD_DRIFT';
  }

  /**
   * Log a repair entry when hard drift occurs.
   */
  logRepair(
    agentId: string,
    sessionId: string,
    turnNumber: number,
    outputText: string
  ): number {
    const latest = this.db.history.getLatest(agentId, sessionId);
    const distance = latest?.distance ?? 0;

    return this.db.repair.append({
      agent_id: agentId,
      session_id: sessionId,
      turn_number: turnNumber,
      distance,
      hard_limit: 0.55, // TODO: read from config
      message_excerpt: outputText.slice(0, 200),
    });
  }
}
