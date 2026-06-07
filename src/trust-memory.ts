/**
 * Seal Gate v0.4 — Trust Memory
 * Cross-session agent reliability tracking: recurrent pattern count,
 * reliability score, and drift trend.
 *
 * Stateless core: TrustMemory holds in-memory state.
 * Callers are responsible for persistence (serialize/deserialize via toJSON/fromJSON).
 */
import { Verdict } from './types.ts'

export interface ReviewRecord {
  ts: number           // Unix ms
  verdict: Verdict
  trust_score: number  // 0–100 final trust_score from Seal.review()
  risk_level: string
  blocking_count: number
}

export interface AgentSummary {
  agent_id: string
  reliability_score: number | null  // null if no history
  drift_trend: 'improving' | 'stable' | 'degrading'
  review_count: number
  last_reviewed_at: number | null
}

export interface TrustMemoryOptions {
  maxHistory?: number  // cap per agent (default 50)
  driftThreshold?: number  // score delta to classify as improving/degrading (default 15)
}

// Verdict → base score contribution (0–100)
const VERDICT_SCORE: Record<Verdict, number> = {
  'PASS': 100,
  'PASS_WITH_WARNINGS': 80,
  'REVISE': 50,
  'ESCALATE_TO_HUMAN': 20,
  'BLOCK': 0,
}

/**
 * Compute weighted reliability score from review history.
 * More recent reviews have higher weight (linear decay).
 * Returns null for empty history.
 */
export function computeReliabilityScore(records: ReviewRecord[]): number | null {
  if (records.length === 0) return null

  const n = records.length
  let totalWeight = 0
  let weightedSum = 0

  records.forEach((r, i) => {
    // Linear weight: oldest = 1, most recent = n
    const weight = i + 1
    const verdictScore = VERDICT_SCORE[r.verdict] ?? 50
    // Blend verdict score (70%) with actual trust_score (30%)
    const blended = verdictScore * 0.7 + r.trust_score * 0.3
    weightedSum += blended * weight
    totalWeight += weight
  })

  return Math.round(weightedSum / totalWeight)
}

/**
 * Classify drift trend by splitting at the time midpoint (not count midpoint).
 * Time-midpoint avoids skew when reviews are temporally clustered.
 * Returns 'stable' for fewer than 2 records or when either half is empty.
 */
export function getDriftTrend(
  records: ReviewRecord[],
  threshold = 15,
): 'improving' | 'stable' | 'degrading' {
  if (records.length < 2) return 'stable'

  // Sort by ts to ensure correct temporal split
  const sorted = [...records].sort((a, b) => a.ts - b.ts)
  const midTs = (sorted[0].ts + sorted[sorted.length - 1].ts) / 2
  const first  = sorted.filter(r => r.ts <= midTs)
  const second = sorted.filter(r => r.ts > midTs)

  if (first.length === 0 || second.length === 0) return 'stable'

  const avg = (rs: ReviewRecord[]) =>
    rs.reduce((s, r) => s + r.trust_score, 0) / rs.length

  const delta = avg(second) - avg(first)

  if (delta > threshold) return 'improving'
  if (delta < -threshold) return 'degrading'
  return 'stable'
}

/** Sort by ts and cap — used for real-time record(). */
function sortAndCap(records: ReviewRecord[], maxHistory: number): ReviewRecord[] {
  return [...records].sort((a, b) => a.ts - b.ts).slice(-maxHistory)
}

/** Sort, dedup same-ts (keep last), and cap — used only when loading persisted data. */
function normalizeFromPersistence(records: ReviewRecord[], maxHistory: number): ReviewRecord[] {
  const sorted = [...records].sort((a, b) => a.ts - b.ts)
  const seen = new Map<number, ReviewRecord>()
  for (const r of sorted) seen.set(r.ts, r)
  return [...seen.values()].sort((a, b) => a.ts - b.ts).slice(-maxHistory)
}

export class TrustMemory {
  private store: Map<string, ReviewRecord[]> = new Map()
  private readonly maxHistory: number
  private readonly driftThreshold: number

  constructor(options: TrustMemoryOptions = {}) {
    this.maxHistory = options.maxHistory ?? 50
    this.driftThreshold = options.driftThreshold ?? 15
  }

  /** Append a review result for an agent. Keeps history sorted by ts, capped to maxHistory. */
  record(agent_id: string, review: Omit<ReviewRecord, 'ts'> & { ts?: number }): void {
    const entry: ReviewRecord = { ts: review.ts ?? Date.now(), ...review }
    const history = this.store.get(agent_id) ?? []
    history.push(entry)
    this.store.set(agent_id, sortAndCap(history, this.maxHistory))
  }

  /** Get full review history for an agent (oldest first). */
  getHistory(agent_id: string): ReviewRecord[] {
    return [...(this.store.get(agent_id) ?? [])]
  }

  /** Reliability score 0–100, or null if no history. */
  getScore(agent_id: string): number | null {
    return computeReliabilityScore(this.store.get(agent_id) ?? [])
  }

  /** Full summary for an agent. */
  getSummary(agent_id: string): AgentSummary {
    const history = this.store.get(agent_id) ?? []
    const last = history.at(-1)
    return {
      agent_id,
      reliability_score: computeReliabilityScore(history),
      drift_trend: getDriftTrend(history, this.driftThreshold),
      review_count: history.length,
      last_reviewed_at: last?.ts ?? null,
    }
  }

  /** Serialize to plain object (for persistence). */
  toJSON(): Record<string, ReviewRecord[]> {
    return Object.fromEntries(this.store)
  }

  /** Restore from serialized object. Validates, sorts by ts, deduplicates, and caps. */
  static fromJSON(data: Record<string, ReviewRecord[]>, options?: TrustMemoryOptions): TrustMemory {
    const mem = new TrustMemory(options)
    const VALID_VERDICTS = new Set(['PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'ESCALATE_TO_HUMAN', 'BLOCK'])
    for (const [agent_id, records] of Object.entries(data)) {
      if (!Array.isArray(records)) continue
      const valid = records.filter(r =>
        typeof r.ts === 'number' &&
        typeof r.verdict === 'string' && VALID_VERDICTS.has(r.verdict) &&
        typeof r.trust_score === 'number' &&
        typeof r.risk_level === 'string' &&
        typeof r.blocking_count === 'number'
      )
      mem.store.set(agent_id, normalizeFromPersistence(valid, options?.maxHistory ?? 50))
    }
    return mem
  }
}
