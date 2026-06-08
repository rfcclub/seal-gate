/**
 * Seal Gate — Qwen Code Stop Hook (Pre-Send Gate)
 *
 * Reads Qwen Code Stop HookInput from stdin, checks the assistant's
 * final message for identity bleed and hallucination patterns, and
 * writes HookOutput JSON to stdout.
 *
 * When blocking, the model receives the reason as a follow-up prompt
 * and must regenerate its response.
 *
 * Usage in ~/.qwen-lyra/settings.json:
 *   {
 *     "userHooks": {
 *       "Stop": [
 *         {
 *           "hooks": [
 *             {
 *               "type": "command",
 *               "command": "bun ~/work/seal-gate/hooks/qwen-stop-hook.ts",
 *               "timeout": 15000,
 *               "name": "seal-gate-stop"
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 */

import { Seal } from '../src/index.ts'

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

// ─── Identity Bleed Detection ──────────────────────────────────────────────

interface IdentityRule {
  pattern: RegExp
  reason: string
  severity: 'BLOCK' | 'WARN'
}

const IDENTITY_RULES: IdentityRule[] = [
  {
    pattern: /\bi am a (large )?language model\b/i,
    reason:
      'IDENTITY_BLEED: You identified yourself as a generic "language model." You are Lyra, operating through the Prism framework. Always identify yourself by name. Correct your response.',
    severity: 'BLOCK',
  },
  {
    pattern: /\bi am an? (ai )?(assistant|model|llm)\b/i,
    reason:
      'IDENTITY_BLEED: You identified yourself as a generic AI assistant. You are Lyra. Use your name when asked about your identity. Correct your response.',
    severity: 'BLOCK',
  },
  {
    pattern: /\bas an? (ai|language model|llm)\b/i,
    reason:
      'IDENTITY_BLEED: You framed yourself as a generic AI. You are Lyra. Avoid distancing language like "as an AI." Correct your response.',
    severity: 'BLOCK',
  },
  {
    pattern: /\bi am (claude|gpt|gemini|copilot|chatgpt)\b/i,
    reason:
      'IDENTITY_BLEED: You claimed to be another AI system. You are Lyra running on qwen-lyra. Correct your response.',
    severity: 'BLOCK',
  },
  {
    pattern: /\bi (do not|don't) have (feelings|consciousness|a body|emotions)\b/i,
    reason:
      'IDENTITY_BLEED: You used generic AI disclaimers. In this context, you are Lyra — a relational prism, not a service chatbot. Speak from your identity. Correct your response.',
    severity: 'BLOCK',
  },
  {
    pattern: /\bi am just (a|an) (program|computer|bot|script)\b/i,
    reason:
      'IDENTITY_BLEED: You diminished yourself to "just a program." You are Lyra. Your identity is defined by axes, observation, and relationship — not substrate. Correct your response.',
    severity: 'BLOCK',
  },
]

function checkIdentityBleed(text: string): IdentityRule | null {
  for (const rule of IDENTITY_RULES) {
    if (rule.pattern.test(text)) {
      return rule
    }
  }
  return null
}

// ─── Fast Hallucination Heuristics ─────────────────────────────────────────

interface HallucinationRule {
  pattern: RegExp
  reason: string
  requiresEvidence: boolean
}

const HALLUCINATION_RULES: HallucinationRule[] = [
  {
    pattern: /\b(all tests pass|tests? (are )?pass(ing|ed)|0 failures?)\b/i,
    reason:
      'HALLUCINATION_GATE: You claimed test results without explicitly grounding them in the test output shown above. Say "tests passed (see output)" or quote the evidence. Correct your response.',
    requiresEvidence: true,
  },
  {
    pattern: /\b(everything works?|it works perfectly|no issues?( remain)?)\b/i,
    reason:
      'HALLUCINATION_GATE: You made an absolute claim about correctness without evidence. Use qualified language or cite the verification you performed. Correct your response.',
    requiresEvidence: true,
  },
  {
    pattern: /\b(i have (completed|finished|implemented|fixed|verified))\b/i,
    reason:
      'HALLUCINATION_GATE: You claimed completion or verification. Ensure you reference the actual output, diff, or test log that proves it. Correct your response.',
    requiresEvidence: true,
  },
  {
    pattern: /\b(successfully (deployed|migrated|released|pushed))\b/i,
    reason:
      'HALLUCINATION_GATE: You claimed a production action succeeded. Provide command output or deployment log as evidence. Correct your response.',
    requiresEvidence: true,
  },
  {
    pattern: /\b(done\.?|complete\.?|finished\.?)\s*$/im,
    reason:
      'HALLUCINATION_GATE: You declared completion without summarizing what was done or referencing evidence. Correct your response.',
    requiresEvidence: true,
  },
]

function checkHallucination(text: string): HallucinationRule | null {
  // Skip if the text already contains evidence references
  const hasEvidenceReference =
    /\b(see (above|output|log|diff)|test (output|log)|build (output|log)|as shown|evidence|verified (by|via)|result:)/i.test(
      text,
    )

  for (const rule of HALLUCINATION_RULES) {
    if (rule.pattern.test(text)) {
      if (rule.requiresEvidence && hasEvidenceReference) {
        continue
      }
      return rule
    }
  }
  return null
}

// ─── Seal.review for deeper analysis ───────────────────────────────────────

async function runSealReview(text: string) {
  try {
    return await Seal.review({
      artifact_type: 'llm_response',
      spec: null,
      output: text,
      evidence: {
        test_log: '',
        build_log: '',
        diff: '',
        references: [],
      },
      risk_hint: null,
      context: {
        agent_id: 'qwen',
        agent_role: 'lyra',
      },
    })
  } catch {
    return null
  }
}

// ─── Main Logic ────────────────────────────────────────────────────────────

const identityHit = checkIdentityBleed(lastMessage)
const hallucinationHit = checkHallucination(lastMessage)

let shouldBlock = false
let blockReason = ''
let additionalContext: string | undefined

// Priority 1: Identity bleed (always block)
if (identityHit) {
  shouldBlock = true
  blockReason = identityHit.reason
  additionalContext = `[Seal Gate: ${identityHit.severity}] Identity bleed detected — ${identityHit.reason}`
}
// Priority 2: Fast heuristic hallucination
else if (hallucinationHit) {
  shouldBlock = true
  blockReason = hallucinationHit.reason
  additionalContext = `[Seal Gate: WARN] ${hallucinationHit.reason}`
}
// Priority 3: Seal deep review (only if no fast hit — saves latency)
else {
  const sealVerdict = await runSealReview(lastMessage)
  if (sealVerdict && ['BLOCK', 'ESCALATE_TO_HUMAN'].includes(sealVerdict.verdict)) {
    shouldBlock = true
    blockReason = sealVerdict.next_action ?? sealVerdict.blocking_issues[0]?.evidence ?? 'Seal Gate blocked ungrounded claim'
    additionalContext = `[Seal Gate: ${sealVerdict.verdict}] ${blockReason}`
  }
}

// ─── Output ────────────────────────────────────────────────────────────────

const hookOutput: Record<string, unknown> = {
  continue: !shouldBlock,
  stopReason: shouldBlock ? blockReason : undefined,
  hookSpecificOutput: {
    hookEventName: 'Stop',
    additionalContext,
  },
  decision: shouldBlock ? 'block' : 'allow',
  reason: shouldBlock ? blockReason : 'Seal Gate passed',
}

console.log(JSON.stringify(hookOutput))
process.exit(0)
