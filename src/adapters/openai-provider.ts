/**
 * GenericOpenAIProvider — config-driven LLM reviewer.
 * Reads provider config from ~/.anima/providers.d/<name>.yaml (same format ANIMA uses).
 * Resolves ${ENV_VAR} in apiKey automatically.
 * Auto-appends /chat/completions to baseUrl.
 *
 * Usage:
 *   Seal.withLLM(createReviewerFromProvider('minimax'))
 *   Seal.withLLM(createReviewerFromProvider('xiaomi'))
 *   Seal.withLLM(createReviewerFromProvider('gemini'))
 *   Seal.withLLM(new GenericOpenAIProvider({
 *     baseUrl: 'https://api.custom.com/v1',
 *     model: 'my-model',
 *     apiKey: 'sk-...',
 *   }))
 */
import { LLMReviewerAdapter, LLMSignals, SealInput, PartialVerdict } from '../types.ts'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ProviderConfig {
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs?: number
}

const SYSTEM_PROMPT = `You are Seal, a quality gate in an AI engineering workflow.

Your job is NOT to be polite or creative. Detect semantic issues the deterministic rules could not catch.

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

confidence: 0.0–1.0. Empty arrays if output is correct. No padding.`

function buildMessage(input: SealInput, partial: PartialVerdict): string {
  const parts: string[] = []
  if (input.spec) parts.push(`=== SPEC ===\n${input.spec}`)
  parts.push(`=== OUTPUT (${input.artifact_type}) ===\n${input.output}`)
  const blocking = partial.deterministic_findings.filter(f => f.is_blocking)
  if (blocking.length) {
    parts.push(`=== ALREADY FLAGGED ===\n${blocking.map(f => `- [${f.rule_id ?? f.type}] ${f.evidence}`).join('\n')}`)
  }
  parts.push(`=== PARTIAL VERDICT ===\ntrust_score: ${partial.trust_score}, risk: ${partial.risk_level}`)
  return parts.join('\n\n')
}

function extractJSON(raw: string): string {
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const m = stripped.match(/\{[\s\S]*\}/)
  return m ? m[0] : stripped
}

function resolveEnvRef(value: string): string {
  // Resolve ${VAR_NAME} pattern
  return value.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '')
}

/** Load and parse a provider YAML from ~/.anima/providers.d/<name>.yaml */
export function loadProviderConfig(name: string, modelIndex = 0): ProviderConfig {
  const path = join(homedir(), '.anima', 'providers.d', `${name}.yaml`)
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    throw new Error(`Provider config not found: ${path}`)
  }

  // Minimal YAML parser — handles the providers.d format
  const get = (key: string) => {
    const m = raw.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  }

  const baseUrl = get('baseUrl')
  const rawKey  = get('apiKey')
  const apiKey  = resolveEnvRef(rawKey)

  // Extract models list (lines like "  - id: MiniMax-M3")
  const models = [...raw.matchAll(/^\s+-\s+id:\s+(.+)$/gm)].map(m => m[1].trim())
  const model = models[modelIndex] ?? models[0] ?? 'default'

  if (!baseUrl) throw new Error(`Provider ${name}: baseUrl missing`)

  return { baseUrl, model, apiKey }
}

export class GenericOpenAIProvider implements LLMReviewerAdapter {
  private config: Required<ProviderConfig>

  constructor(config: ProviderConfig) {
    this.config = { timeoutMs: 30_000, ...config }
  }

  async review(input: SealInput, partial: PartialVerdict): Promise<LLMSignals> {
    const { baseUrl, model, apiKey, timeoutMs } = this.config
    const endpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl.replace(/\/$/, '')}/chat/completions`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await fetch(endpoint, {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey ? `Bearer ${apiKey}` : 'Bearer none',
        },
        body: JSON.stringify({
          model,
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
      throw new Error(`[${model}] ${response.status}: ${body.slice(0, 200)}`)
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    const raw = data.choices?.[0]?.message?.content ?? '{}'

    let signals: Partial<LLMSignals>
    try { signals = JSON.parse(extractJSON(raw)) }
    catch { throw new Error(`[${model}] invalid JSON: ${raw.slice(0, 200)}`) }

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

/**
 * Create a reviewer from ~/.anima/providers.d/<name>.yaml
 * modelIndex: which model from the models list (default 0 = first/best)
 */
export function createReviewerFromProvider(name: string, modelIndex = 0): GenericOpenAIProvider {
  return new GenericOpenAIProvider(loadProviderConfig(name, modelIndex))
}
