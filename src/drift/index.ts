export { DriftDb } from './drift-db.ts';
export { BaselineManager } from './baseline.ts';
export { Embedder, cosineDistance } from './embedder.ts';
export { DriftGuard } from './drift-guard.ts';
export { SoftCorrection } from './soft-correction.ts';
export { Quarantine } from './quarantine.ts';
export { driftScoreForTrust } from './trust-integration.ts';

export type {
  DriftStatus,
  DriftAction,
  DriftResult,
  DriftGuardOptions,
} from './drift-guard.ts';

export type {
  BaselineStatus,
  BaselinePaths,
  BaselineResult,
} from './baseline.ts';
