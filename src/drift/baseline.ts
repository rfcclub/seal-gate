import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { DriftDb } from './drift-db.js';
import { Embedder } from './embedder.js';

export type BaselineStatus = 'READY' | 'DEGRADED' | 'MISSING';

export interface BaselinePaths {
  soulPath: string;
  axiomsPath?: string;
  primePath?: string;
}

export interface BaselineResult {
  vector: number[];
  hash: string;
  status: BaselineStatus;
}

/**
 * Manages per-agent identity baseline vectors.
 * Loads substrate files, caches by content hash, and delegates encoding to Embedder.
 */
export class BaselineManager {
  private db: DriftDb;
  private embedder: Embedder;
  private statusMap = new Map<string, BaselineStatus>();

  constructor(db: DriftDb, embedder?: Embedder) {
    this.db = db;
    this.embedder = embedder ?? new Embedder();
  }

  /**
   * Get or compute the baseline vector for an agent.
   * Caches by SHA-256 hash of concatenated substrate text.
   */
  async getOrCompute(agentId: string, paths: BaselinePaths): Promise<BaselineResult> {
    const substrate = this.readSubstrate(paths);

    if (!substrate.found) {
      this.statusMap.set(agentId, 'DEGRADED');
      return {
        vector: new Array(this.embedder.dim).fill(0),
        hash: '',
        status: 'DEGRADED',
      };
    }

    const hash = createHash('sha256').update(substrate.text).digest('hex');

    // Check cache
    const cached = this.db.baseline.get(agentId);
    if (cached && cached.content_hash === hash) {
      this.statusMap.set(agentId, 'READY');
      return {
        vector: JSON.parse(cached.baseline_vector) as number[],
        hash,
        status: 'READY',
      };
    }

    // Compute and cache
    const vector = await this.embedder.encode(substrate.text);
    this.db.baseline.set(agentId, vector, hash, 'all-MiniLM-L6-v2');
    this.statusMap.set(agentId, 'READY');

    return { vector, hash, status: 'READY' };
  }

  /**
   * Get the cached baseline without recomputing.
   * Returns zero vector if not yet computed.
   */
  getCached(agentId: string): number[] | null {
    const cached = this.db.baseline.get(agentId);
    if (!cached) return null;
    return JSON.parse(cached.baseline_vector) as number[];
  }

  status(agentId: string): BaselineStatus {
    return this.statusMap.get(agentId) ?? 'MISSING';
  }

  private readSubstrate(paths: BaselinePaths): { text: string; found: boolean } {
    const parts: string[] = [];

    if (paths.soulPath && existsSync(paths.soulPath)) {
      parts.push(readFileSync(paths.soulPath, 'utf-8'));
    }

    if (paths.axiomsPath && existsSync(paths.axiomsPath)) {
      parts.push(readFileSync(paths.axiomsPath, 'utf-8'));
    }

    if (paths.primePath && existsSync(paths.primePath)) {
      parts.push(readFileSync(paths.primePath, 'utf-8'));
    }

    if (parts.length === 0) {
      return { text: '', found: false };
    }

    return { text: parts.join('\n---\n'), found: true };
  }
}
