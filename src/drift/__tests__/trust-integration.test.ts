import { describe, it, expect } from 'bun:test';
import { driftScoreForTrust } from '../trust-integration.ts';

describe('driftScoreForTrust', () => {
  it('NORMAL → 1.0', () => {
    expect(driftScoreForTrust('NORMAL', 0.12)).toBe(1.0);
  });

  it('HARD_DRIFT → 0.0', () => {
    expect(driftScoreForTrust('HARD_DRIFT', 0.6)).toBe(0.0);
    expect(driftScoreForTrust('HARD_DRIFT', 0.9)).toBe(0.0);
  });

  it('SOFT_DRIFT → partial [0.5, 1.0)', () => {
    const s1 = driftScoreForTrust('SOFT_DRIFT', 0.30, { hardLimit: 0.55 });
    expect(s1).toBeGreaterThan(0.5);
    expect(s1).toBeLessThanOrEqual(1.0);

    const s2 = driftScoreForTrust('SOFT_DRIFT', 0.50, { hardLimit: 0.55 });
    expect(s2).toBeLessThan(s1);
    expect(s2).toBeGreaterThan(0);
  });
});
