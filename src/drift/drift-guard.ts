import { DriftDb } from './drift-db.js';
import { BaselineManager } from './baseline.js';
import { Embedder, cosineDistance } from './embedder.js';
import { Quarantine } from './quarantine.js';
import { SoftCorrection } from './soft-correction.js';

export type DriftStatus = 'NORMAL' | 'SOFT_DRIFT' | 'HARD_DRIFT';

export interface DriftAction {
  type: 'NONE' | 'INJECT_RE_ANCHOR' | 'QUARANTINE' | 'FULL_SOUL_RELOAD';
  payload?: string;
}

export interface DriftResult {
  status: DriftStatus;
  distance: number;
  action: DriftAction;
  softLimit: number;
  hardLimit: number;
}

export interface DriftGuardOptions {
  db: DriftDb;
  embedder?: Embedder;
  baselineManager?: BaselineManager;
  softLimit?: number;
  hardLimit?: number;
  cadence?: number;
}

/**
 * Per-turn drift detection orchestrator.
 * Stateless between calls except for DB persistence.
 */
export class DriftGuard {
  private db: DriftDb;
  private baseline: BaselineManager;
  private embedder: Embedder;
  private softLimit: number;
  private hardLimit: number;
  private cadence: number;
  private quarantine: Quarantine;
  private softCorrection: SoftCorrection;

  constructor(opts: DriftGuardOptions) {
    this.db = opts.db;
    this.embedder = opts.embedder ?? new Embedder();
    this.baseline = opts.baselineManager ?? new BaselineManager(this.db, this.embedder);
    this.softLimit = opts.softLimit ?? 0.30;
    this.hardLimit = opts.hardLimit ?? 0.55;
    this.cadence = opts.cadence ?? 1;
    this.quarantine = new Quarantine(this.db);
    this.softCorrection = new SoftCorrection();
  }

  /**
   * Classify a raw distance value into drift tier.
   */
  classify(distance: number): DriftStatus {
    if (distance >= this.hardLimit) return 'HARD_DRIFT';
    if (distance >= this.softLimit) return 'SOFT_DRIFT';
    return 'NORMAL';
  }

  /**
   * Run a full drift detection cycle for one turn.
   */
  async runCycle(
    agentId: string,
    sessionId: string,
    turnNumber: number,
    outputText: string
  ): Promise<DriftResult> {
    // Cadence gate
    if (this.cadence > 1 && turnNumber % this.cadence !== 0) {
      return {
        status: 'NORMAL',
        distance: 0,
        action: { type: 'NONE' },
        softLimit: this.softLimit,
        hardLimit: this.hardLimit,
      };
    }

    // Load baseline
    const baselineVec = this.baseline.getCached(agentId);
    if (!baselineVec) {
      // First run — wizard or degraded. Defer detection.
      return {
        status: 'NORMAL',
        distance: 0,
        action: { type: 'NONE', payload: 'Baseline not loaded for this agent.' },
        softLimit: this.softLimit,
        hardLimit: this.hardLimit,
      };
    }

    // Encode current output
    const currentVec = await this.embedder.encode(outputText);

    // Compare
    const distance = cosineDistance(baselineVec, currentVec);
    const status = this.classify(distance);

    // Record history
    this.db.history.append({
      agent_id: agentId,
      session_id: sessionId,
      turn_number: turnNumber,
      current_vector: currentVec,
      distance,
      status,
      timestamp: new Date().toISOString(),
    });

    // Determine action
    let action: DriftAction = { type: 'NONE' };

    if (status === 'SOFT_DRIFT') {
      const payload = this.softCorrection.generate({
        name: agentId,
        primeDirective: 'Reset to baseline identity. Do not drift.',
        relationship: 'agent',
        axiomKeyphrase: 'Identity anchor',
      });
      if (payload) {
        const reAnchorId = this.db.pending.set(agentId, sessionId, payload);
        action = { type: 'INJECT_RE_ANCHOR', payload };
      }
    }

    if (status === 'HARD_DRIFT') {
      this.quarantine.logRepair(agentId, sessionId, turnNumber, outputText);
      action = { type: 'QUARANTINE' };
    }

    return {
      status,
      distance,
      action,
      softLimit: this.softLimit,
      hardLimit: this.hardLimit,
    };
  }
}
