/**
 * Seal Gate — Qwen Code Stop Hook (Pre-Send Gate)
 *
 * Reads Qwen Code Stop HookInput from stdin, checks the assistant's
 * final message via lyraExtension for identity bleed and hallucination,
 * and writes HookOutput JSON to stdout.
 *
 * Usage in ~/.qwen-lyra/settings.json:
 *   {
 *     "userHooks": {
 *       "Stop": [
 *         { "hooks": [{ "type": "command",
 *             "command": "bun ~/work/seal-gate/hooks/qwen-stop-hook.ts",
 *             "timeout": 15000, "name": "seal-gate-stop" }] }
 *       ]
 *     }
 *   }
 */

import { Seal } from '../src/index.ts'
import { lyraExtension } from '../src/extensions/lyra/index.ts'

Seal.extend(lyraExtension)

// ─── Read stdin ────────────────────────────────────────────────────────────

const rawInput = await new Response(Bun.stdin).text()

let hookInput: Record<string, unknown> = {}
try {
  hookInput = JSON.parse(rawInput)
} catch {
  console.log(JSON.stringify({ continue: true }))
  process.exit(0)
}

const lastMessage = (hookInput.last_assistant_message as string) ?? ''

if (!lastMessage) {
  console.log(JSON.stringify({ continue: true }))
  process.exit(0)
}

// ─── Seal review via lyraExtension ────────────────────────────────────────

let verdict
try {
  verdict = await Seal.review({
    artifact_type: 'llm_response',
    spec: null,
    output: lastMessage,
    evidence: { test_log: '', build_log: '', diff: '', references: [] },
    risk_hint: null,
    context: {
      agent_id: 'lyra',
      agent_role: 'lyra',
    },
  })
} catch {
  console.log(JSON.stringify({ continue: true }))
  process.exit(0)
}

// ─── Output ────────────────────────────────────────────────────────────────

const shouldBlock = verdict && ['BLOCK', 'ESCALATE_TO_HUMAN'].includes(verdict.verdict)
const blockReason = shouldBlock
  ? (verdict!.blocking_issues[0]?.evidence ?? verdict!.next_action ?? 'Seal Gate: identity bleed or hallucination detected')
  : undefined

console.log(JSON.stringify({
  continue: !shouldBlock,
  stopReason: blockReason,
  hookSpecificOutput: {
    hookEventName: 'Stop',
    additionalContext: shouldBlock ? `[Seal Gate: BLOCK] ${blockReason}` : undefined,
  },
  decision: shouldBlock ? 'block' : 'allow',
  reason: shouldBlock ? blockReason : 'Seal Gate passed',
}))

process.exit(0)
