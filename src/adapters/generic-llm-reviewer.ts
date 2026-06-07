/**
 * Generic OpenAI-compatible LLM Reviewer Adapter
 * Works with any provider that speaks the OpenAI chat completions API:
 * MiniMax, Fireworks, Gemini (OpenAI-compat), Qwen/MiMo, local (port 3546), etc.
 *
 * Usage:
 *   Seal.withLLM(createReviewer({ provider: 'minimax' }))
 *   Seal.withLLM(createReviewer({ provider: 'fireworks', model: 'accounts/...' }))
 *   Seal.withLLM(createReviewer({ baseUrl: 'http://localhost:3546/v1', apiKey: 'none', model: 'local' }))
 */
import { LLMReviewerAdapter, LLMSignals, SealInput, PartialVerdict } from '../types.ts'

// Known providers from ~/.anima/providers.d/
const PROVIDERS: Record<string, { baseUrl: string; apiKeyEnv: string; defaultModel: string }> = {
  minimax:   { baseUrl: 'https://api.minimax.io/v1',               apiKeyEnv: 'MINIMAX_PLAN_KEY',   defaultModel: 'MiniMax-M3' },
  fireworks: { baseUrl: 'https://api.fireworks.ai/inference/v1',   apiKeyEnv: 'FIREWORKS_API_KEY',  defaultModel: 'accounts/fireworks/models/mixtral-8x7b-instruct' },
  gemini:    { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: 'GEMINI_API_KEY', defaultModel: 'gemini-2.0-flash' },
  xiaomimo:  { baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1', apiKeyEnv: 'XIAOMI_MIMO_API_KEY', defaultModel: 'mimo-v2.5-pro' },
  openai:    { baseUrl: 'https://api.openai.com/v1',               apiKeyEnv: 'OPENAI_API_KEY',     defaultModel: 'gpt-4o-mini' },
  local:     { baseUrl: 'http://localhost:3546/v1',                apiKeyEnv: '',                   defaultModel: 'local' },
}

const SYSTEM_PROMPT = `You are Seal, a quality gate in an AI engineering workflow.

Your job is NOT to be polite or creative. Your job is to detect semantic issues the deterministic rules could not catch.

Review AI agent output for semantic correctness, subtle logic bugs, and missing requirements.
The deterministic layer already checked: evidence presence, risk keywords, spec headers, test logs.
Your focus: semantic reasoning, prose logic, subtle edge cases, spec compliance.

Return ONLY valid JSON:
{
  "suspected_issues": ["string — exact reasoning error, max 3"],
  "missing_requirements": ["string — spec requirement clearly absent"],
  "possible_edge_cases": ["string — edge cases to consider"],
  "evidence_gaps": ["string — claims needing evidence that slipped through"],
  "risk_guess": "LOW | MEDIUM | HIGH | CRITICAL",
  "confidence": 0.0
}

Rules: confidence 0.0–1.0. Empty arrays if output is correct. No padding.`

function buildMessage(input: SealInput, partial: PartialVerdict): string {
  const parts: string[] = []
  if (input.spec) parts.push(`=== SPEC ===\n${input.spec}`)
  parts.push(`=== OUTPUT (${input.artifact_type}) ===\n${input.output}`)
  const blocking = partial.deterministic_findings.filter(f => f.is_blocking)
  if (blocking.length) {
    parts.push(`=== ALREADY FLAGGED (do not repeat) ===\n${blocking.map(f => `- [${f.rule_id ?? f.type}] ${f.evidence}`).join('\n')}`)
  }
  parts.push(`=== PARTIAL VERDICT ===\ntrust_score: ${partial.trust_score}, risk: ${partial.risk_level}`)
  return parts.join('\n\n')
}

function extractJSON(raw: string): string {
  // Strip <think>...</think> blocks (thinking models like MiniMax-M3, MiMo)
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const match = stripped.match(/\{[\s\S]*\}/)
  return match ? match[0] : stripped
}

export interface GenericReviewerOptions {
  provider?: keyof typeof PROVIDERS   // named provider from PROVIDERS table
  baseUrl?: string                    // override — takes precedence over provider
  apiKey?: string                     // override — takes precedence over env var
  model?: string                      // override model
  timeoutMs?: number                  // default 30000
}

export class GenericLLMReviewer implements LLMReviewerAdapter {
  private baseUrl: string
  private apiKey: string
  private model: string
  private timeoutMs: number

  constructor(opts: GenericReviewerOptions = {}) {
    const preset = opts.provider ? PROVIDERS[opts.provider] : null

    this.baseUrl  = opts.baseUrl  ?? preset?.baseUrl  ?? PROVIDERS.minimax.baseUrl
    this.apiKey   = opts.apiKey   ?? (preset ? (process.env[preset.apiKeyEnv] ?? '') : (process.env.MINIMAX_PLAN_KEY ?? ''))
    this.model    = opts.model    ?? preset?.defaultModel ?? PROVIDERS.minimax.defaultModel
    this.timeoutMs = opts.timeoutMs ?? 30_000
  }

  async review(input: SealInput, partial: PartialVerdict): Promise<LLMSignals> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : 'Bearer none',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: buildMessage(input, partial) },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 1024,
        }),
      })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`LLM reviewer ${this.model} error ${response.status}: ${body.slice(0, 200)}`)
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const raw = data.choices?.[0]?.message?.content ?? '{}'
    const jsonStr = extractJSON(raw)

    let signals: Partial<LLMSignals>
    try { signals = JSON.parse(jsonStr) }
    catch { throw new Error(`LLM reviewer returned invalid JSON: ${raw.slice(0, 200)}`) }

    const VALID_RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    return {
      suspected_issues:     Array.isArray(signals.suspected_issues)    ? signals.suspected_issues    : [],
      missing_requirements: Array.isArray(signals.missing_requirements) ? signals.missing_requirements : [],
      possible_edge_cases:  Array.isArray(signals.possible_edge_cases)  ? signals.possible_edge_cases  : [],
      evidence_gaps:        Array.isArray(signals.evidence_gaps)        ? signals.evidence_gaps        : [],
      risk_guess:           VALID_RISKS.includes(signals.risk_guess ?? '') ? signals.risk_guess as LLMSignals['risk_guess'] : 'MEDIUM',
      confidence:           typeof signals.confidence === 'number' ? Math.max(0, Math.min(1, signals.confidence)) : 0.5,
    }
  }
}

/** Pre-configured factories */
export const createReviewer = (opts: GenericReviewerOptions) => new GenericLLMReviewer(opts)
export const createMinimaxReviewer  = (model?: string) => new GenericLLMReviewer({ provider: 'minimax',   model })
export const createFireworksReviewer = (model?: string) => new GenericLLMReviewer({ provider: 'fireworks', model })
export const createGeminiReviewer   = (model?: string) => new GenericLLMReviewer({ provider: 'gemini',    model })
export const createMiMoReviewer     = (model?: string) => new GenericLLMReviewer({ provider: 'xiaomimo',  model })
export const createLocalReviewer    = (model?: string) => new GenericLLMReviewer({ provider: 'local',     model })
