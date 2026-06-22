import { createHash } from 'crypto';

/**
 * Cosine distance between two vectors.
 * Returns value in [0, 2] where:
 *   0 = identical direction
 *   1 = orthogonal
 *   2 = opposite direction
 * For drift thresholds, we typically use [0, 1] range (divide by 2)
 * or adjust thresholds accordingly.
 */
export function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  if (a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  // Clamp to [-1, 1] to avoid floating-point drift
  const sim = Math.max(-1, Math.min(1, dot / denom));
  // Distance = 1 - similarity, range [0, 2]
  return 1 - sim;
}

export interface EmbedderBackend {
  readonly isActive: boolean;
  readonly dim: number;
  encode(text: string): Promise<number[]>;
}

/**
 * Naive deterministic embedder.
 * Produces consistent 384-dim vectors from text hash —
 * suitable for testing and as a graceful fallback when ONNX is unavailable.
 * NOT semantically meaningful; replaced by ONNX backend in production.
 */
class NaiveEmbedder implements EmbedderBackend {
  readonly isActive = true;
  readonly dim = 384;

  async encode(text: string): Promise<number[]> {
    const hash = createHash('sha256').update(text).digest();
    const vec = new Array(this.dim);

    // Deterministic pseudo-random expansion from 256-bit hash
    for (let i = 0; i < this.dim; i++) {
      const hashIdx = i % hash.length;
      const seed = hash[hashIdx] ^ (i >>> 3);
      // Signed float in roughly [-0.5, 0.5]
      vec[i] = ((seed / 255) * 2 - 1) * 0.5;
    }

    // L2 normalize for cosine distance stability
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < this.dim; i++) {
        vec[i] /= norm;
      }
    }

    return vec;
  }
}

/**
 * ONNX Runtime embedder (placeholder for now).
 * Attempts to load the ONNX model on first encode().
 * Falls back to NaiveEmbedder if model unavailable.
 */
class OnnxEmbedder implements EmbedderBackend {
  isActive = false;
  readonly dim = 384;
  private modelPath: string;
  private fallback: NaiveEmbedder;
  private triedLoading = false;

  constructor(modelPath?: string) {
    // TODO(v2): resolve path
    this.modelPath = modelPath ?? './models/all-MiniLM-L6-v2.onnx';
    this.fallback = new NaiveEmbedder();
  }

  async encode(text: string): Promise<number[]> {
    if (!this.triedLoading) {
      await this.tryLoad();
      this.triedLoading = true;
    }

    if (!this.isActive) {
      return this.fallback.encode(text);
    }

    // TODO(v2): actual ONNX inference
    // For now, also fall through to naive to keep system working
    console.warn(
      `[Embedder] ONNX model at ${this.modelPath} not loaded; using naive fallback.`
    );
    return this.fallback.encode(text);
  }

  private async tryLoad(): Promise<void> {
    try {
      // Bun's Node-API support may or may not handle onnxruntime-node.
      // We'll attempt dynamic import and catch any failure.
      // const ort = await import('onnxruntime-node');
      // ... load model ...
      // this.isActive = true;

      // Placeholder: always fails until ONNX model is present and Bun support verified
      this.isActive = false;
    } catch {
      this.isActive = false;
    }
  }
}

/**
 * Main embedder facade.
 * Prefers ONNX backend; silently falls back to naive embedder
 * when ONNX is missing or platform-incompatible.
 */
export class Embedder {
  private backend: EmbedderBackend;
  readonly dim: number;

  constructor(modelPath?: string) {
    const onnx = new OnnxEmbedder(modelPath);
    this.backend = onnx.isActive ? onnx : new NaiveEmbedder();
    this.dim = this.backend.dim;
  }

  get isActive(): boolean {
    return this.backend.isActive;
  }

  async encode(text: string): Promise<number[]> {
    const truncated = text.slice(0, 4000); // rough char limit
    return this.backend.encode(truncated);
  }
}
