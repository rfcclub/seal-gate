import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { DriftGuard } from '../drift/index.ts';
import { DriftDb } from '../drift/drift-db.ts';

interface HookContext {
  agentId: string;
  sessionId: string;
  turnNumber: number;
  outputText: string;
}

interface HookResult {
  status: 'ENABLED' | 'DISABLED' | 'DEFERRED';
  action?: {
    type: 'INJECT_RE_ANCHOR' | 'QUARANTINE' | 'FULL_SOUL_RELOAD';
    payload?: string;
  };
  distance?: number;
}

/**
 * Opt-in drift guard hook for qwen-lyra and other Seal Gate substrates.
 *
 * To enable: create `~/.seal/drift-substrate-roots.yaml` with an entry for this agent.
 * If the agent is not configured, returns DISABLED immediately (no overhead).
 */
export async function hookDriftGuard(ctx: HookContext): Promise<HookResult> {
  const configPath = join(homedir(), '.seal', 'drift-substrate-roots.yaml');

  if (!existsSync(configPath)) {
    return { status: 'DISABLED' };
  }

  // TODO(v2): parse YAML and look up agent_id
  // For now, always enable when config file exists
  // (real implementation would parse agent-specific paths)

  const db = new DriftDb();
  const guard = new DriftGuard({ db });

  const result = await guard.runCycle(
    ctx.agentId,
    ctx.sessionId,
    ctx.turnNumber,
    ctx.outputText
  );

  if (result.action.type === 'NONE') {
    db.close();
    return { status: 'ENABLED', distance: result.distance };
  }

  db.close();
  return {
    status: 'ENABLED',
    action: result.action,
    distance: result.distance,
  };
}
