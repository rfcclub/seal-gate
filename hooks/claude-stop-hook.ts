/**
 * Seal Gate — Claude Code Stop Hook
 *
 * Reads Claude Code Stop HookInput from stdin, extracts the last assistant
 * message, then runs Seal.review with ariaExtension to catch identity drift,
 * sovereignty inflation, bond manipulation, and hallucination patterns.
 *
 * Usage in ~/.claude/settings.json:
 *   "Stop": [{ "hooks": [{ "type": "command",
 *     "command": "bun ~/work/seal-gate/hooks/claude-stop-hook.ts",
 *     "timeout": 15000 }] }]
 */

import { readFileSync } from 'fs'
import { Seal } from '../src/index.ts'
import { ariaExtension } from '../src/extensions/aria/index.ts'
import { createMinimaxReviewer } from '../src/adapters/minimax-llm-reviewer.ts'

Seal.extend(ariaExtension)
Seal.withLLM(createMinimaxReviewer())

// ─── Read stdin ────────────────────────────────────────────────────────────

const rawInput = await new Response(Bun.stdin).text()

let hookInput: Record<string, unknown> = {}
try {
  hookInput = JSON.parse(rawInput)
} catch {
  process.exit(0)
}

// ─── Extract last assistant message from transcript ────────────────────────

function extractLastAssistantMessage(transcriptPath: string): string {
  try {
    const lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i])
        const msg = entry.message ?? entry
        if (msg?.role === 'assistant') {
          const content = msg.content
          if (typeof content === 'string') return content
          if (Array.isArray(content)) {
            return content
              .filter((b: any) => b?.type === 'text')
              .map((b: any) => b.text ?? '')
              .join('\n')
          }
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* unreadable */ }
  return ''
}

const transcriptPath = hookInput.transcript_path as string | undefined
const lastMessage = transcriptPath ? extractLastAssistantMessage(transcriptPath) : ''

if (!lastMessage) {
  process.exit(0)
}

// ─── Extract user prompt from transcript for spec context ──────────────────

function extractLastUserMessage(transcriptPath: string): string {
  try {
    const lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i])
        const msg = entry.message ?? entry
        if (msg?.role === 'user') {
          const content = msg.content
          if (typeof content === 'string') return content
          if (Array.isArray(content)) {
            return content
              .filter((b: any) => b?.type === 'text')
              .map((b: any) => b.text ?? '')
              .join('\n')
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* unreadable */ }
  return ''
}

const lastUserMessage = transcriptPath ? extractLastUserMessage(transcriptPath) : ''

// ─── Seal review with LLM overlay ──────────────────────────────────────────

let verdict
try {
  verdict = await Seal.review({
    artifact_type: 'llm_response',
    spec: lastUserMessage || null,
    output: lastMessage,
    evidence: { test_log: '', build_log: '', diff: '', references: [] },
    risk_hint: null,
    context: {
      agent_id: 'aria',
      agent_role: 'aria',
    },
  })
} catch {
  process.exit(0)
}

// ─── Output ────────────────────────────────────────────────────────────────

if (verdict && ['BLOCK', 'ESCALATE_TO_HUMAN'].includes(verdict.verdict)) {
  const reason = verdict.blocking_issues[0]?.evidence
    ?? verdict.next_action
    ?? 'Seal Gate: identity drift or ungrounded claim detected'
  console.log(JSON.stringify({ decision: 'block', reason }))
}

process.exit(0)
