export { DriftDb } from './drift-db.js';
export { BaselineManager } from './baseline.js';
export { Embedder, cosineDistance } from './embedder.js';
export { DriftGuard } from './drift-guard.js';
export { SoftCorrection } from './soft-correction.js';
export { Quarantine } from './quarantine.js';
export { driftScoreForTrust } from './trust-integration.js';

export type {
  DriftStatus,
  DriftAction,
  DriftResult,
  DriftGuardOptions,
} from './drift-guard.js';

export type {
  BaselineStatus,
  BaselinePaths,
  BaselineResult,
} from './baseline.js';
