import type { DriftStatus } from './drift-guard.js';

/**
 * Lightweight adapter: map drift distance/status to [0,1] reliability score
 * that can be fed into TrustMemory.
 *
 * Safe to import even when TrustMemory v2 is not yet integrated:
 * this module has zero side effects and produces a plain number.
 */
export function driftScoreForTrust(
  status: DriftStatus,
  distance: number,
  options?: { hardLimit: number }
): number {
  const hard = options?.hardLimit ?? 0.55;

  switch (status) {
    case 'NORMAL':
      return 1.0;
    case 'SOFT_DRIFT': {
      // Linear degradation from 1.0 at soft_limit to 0.5 at hard_limit
      const t = Math.min(distance / hard, 1.0);
      return 1.0 - t * 0.5;
    }
    case 'HARD_DRIFT':
      return 0.0;
  }
}
