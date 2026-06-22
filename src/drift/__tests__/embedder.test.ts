import { describe, it, expect } from 'bun:test';
import { cosineDistance, Embedder } from '../embedder.ts';

describe('cosineDistance', () => {
  it('same vector = 0', () => {
    const v = [1, 0, 0];
    expect(cosineDistance(v, v)).toBeCloseTo(0, 5);
  });

  it('orthogonal = ~1', () => {
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1, 5);
  });

  it('opposite = ~2', () => {
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2, 5);
  });

  it('throws on length mismatch', () => {
    expect(() => cosineDistance([1, 2], [1])).toThrow('mismatch');
  });

  it('empty vectors = 0', () => {
    expect(cosineDistance([], [])).toBe(0);
  });
});

describe('Embedder', () => {
  it('is active even without ONNX (naive fallback)', async () => {
    const e = new Embedder('/nonexistent/model.onnx');
    expect(e.isActive).toBe(true); // naive backend is always active
  });

  it('encodes to 384-dim vector', async () => {
    const e = new Embedder();
    const vec = await e.encode('Hello Lyra Prism');
    expect(vec).toHaveLength(384);
    expect(vec.every((n) => typeof n === 'number' && !isNaN(n))).toBe(true);
  });

  it('produces consistent vectors for same text', async () => {
    const e = new Embedder();
    const v1 = await e.encode('Same text');
    const v2 = await e.encode('Same text');
    expect(v1).toEqual(v2);
  });

  it('produces different vectors for different text', async () => {
    const e = new Embedder();
    const v1 = await e.encode('Aria Buddhist companion');
    const v2 = await e.encode('Coda workshop evidence');
    const dist = cosineDistance(v1, v2);
    // Naive embedder: different inputs should differ measurably
    expect(dist).toBeGreaterThan(0.01);
  });

  it('truncates very long text', async () => {
    const e = new Embedder();
    const long = 'a'.repeat(10000);
    const vec = await e.encode(long);
    expect(vec).toHaveLength(384);
  });
});
