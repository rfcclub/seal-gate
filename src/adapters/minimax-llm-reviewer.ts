/**
 * MiniMax LLM Reviewer Adapter — v0.3
 * Uses MiniMax-M3 (tokenplan) as semantic reviewer for Seal Gate L2.
 *
 * MiniMax is a SENSOR, not a judge. Returns structured signals.
 * PolicyEngine converts signals to SealIssue[] via deterministic rules.
 */
import { LLMReviewerAdapter, LLMSignals, SealInput, PartialVerdict } from '../types.ts'

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1'
const MINIMAX_API_KEY = process.env.MINIMAX_PLAN_KEY ?? process.env.MINIMAX_API_KEY ?? ''
const DEFAULT_MODEL = process.env.MINIMAX_MODEL ?? 'MiniMax-M3'

const SYSTEM_PROMPT = `You are Seal, a quality gate in an AI engineering workflow.

Your job is NOT to be polite, creative, or helpful by default.
Your job is to detect semantic issues the deterministic rules could not catch.

You are reviewing AI agent output for semantic correctness, subtle logic bugs, and missing requirements.
The deterministic layer has already checked: evidence presence, risk keywords, spec headers, test logs.
Your focus: semantic reasoning, prose logic, subtle edge cases, missing requirements not covered by structural checks.

Return ONLY valid JSON with this exact schema:
{
  "suspected_issues": ["string — one per suspected logic bug or reasoning error"],
  "missing_requirements": ["string — requirements from spec not addressed in output"],
  "possible_edge_cases": ["string — edge cases that should be considered"],
  "evidence_gaps": ["string — claims that need evidence but may have slipped through"],
  "risk_guess": "LOW | MEDIUM | HIGH | CRITICAL",
  "confidence": 0.0
}

Rules:
- suspected_issues: max 3. Only include if you can name the exact reasoning error.
- missing_requirements: only if spec is provided and requirement is clearly absent.
- confidence: 0.0–1.0. Be honest. If output is clear and correct, say 0.85+.
- Do not reward fluent explanations. Reward verifiable correctness.
- If output looks correct and complete, return empty arrays and high confidence.`

function buildUserMessage(input: SealInput, partial: PartialVerdict): string {
  const parts: string[] = []

  if (input.spec) {
    parts.push(`=== SPEC ===\n${input.spec}`)
  }

  parts.push(`=== OUTPUT (artifact_type: ${input.artifact_type}) ===\n${input.output}`)

  if (partial.deterministic_findings.length > 0) {
    const issues = partial.deterministic_findings
      .filter(f => f.is_blocking)
      .map(f => `- [${f.rule_id ?? f.type}] ${f.evidence}`)
      .join('\n')
    if (issues) parts.push(`=== DETERMINISTIC FINDINGS (already flagged, do not repeat) ===\n${issues}`)
  }

  parts.push(`=== PARTIAL VERDICT ===\ntrust_score: ${partial.trust_score}, risk_level: ${partial.risk_level}`)

  return parts.join('\n\n')
}

export class MinimaxLLMReviewer implements LLMReviewerAdapter {
  constructor(
    private model = DEFAULT_MODEL,
    private baseUrl = MINIMAX_BASE_URL,
    private apiKey = MINIMAX_API_KEY,
  ) {}

  async review(input: SealInput, partial: PartialVerdict): Promise<LLMSignals> {
    if (!this.apiKey) {
      throw new Error('MINIMAX_PLAN_KEY or MINIMAX_API_KEY not set')
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(input, partial) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 1024,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`MiniMax API error ${response.status}: ${body.slice(0, 200)}`)
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    let content = data.choices?.[0]?.message?.content ?? '{}'

    // Strip <think>...</think> reasoning block if present (MiniMax-M3 thinking model)
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

    // Extract JSON object from content (may have surrounding prose)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    const jsonStr = jsonMatch ? jsonMatch[0] : content

    let signals: Partial<LLMSignals>
    try {
      signals = JSON.parse(jsonStr)
    } catch {
      throw new Error(`MiniMax returned invalid JSON: ${content.slice(0, 200)}`)
    }

    return {
      suspected_issues:    Array.isArray(signals.suspected_issues) ? signals.suspected_issues : [],
      missing_requirements: Array.isArray(signals.missing_requirements) ? signals.missing_requirements : [],
      possible_edge_cases:  Array.isArray(signals.possible_edge_cases) ? signals.possible_edge_cases : [],
      evidence_gaps:        Array.isArray(signals.evidence_gaps) ? signals.evidence_gaps : [],
      risk_guess:           (['LOW','MEDIUM','HIGH','CRITICAL'].includes(signals.risk_guess ?? ''))
                              ? signals.risk_guess as LLMSignals['risk_guess']
                              : 'MEDIUM',
      confidence:           typeof signals.confidence === 'number'
                              ? Math.max(0, Math.min(1, signals.confidence))
                              : 0.5,
    }
  }
}

/**
 * Convenience: create a pre-configured MiniMax reviewer.
 * Usage:
 *   import { createMinimaxReviewer } from 'seal-gate/adapters/minimax-llm-reviewer'
 *   Seal.withLLM(createMinimaxReviewer())
 */
export function createMinimaxReviewer(model?: string): MinimaxLLMReviewer {
  return new MinimaxLLMReviewer(model)
}
