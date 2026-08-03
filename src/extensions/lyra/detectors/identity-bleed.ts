import { SealIssue } from '../../../types.js'
import { makeLyraIssue } from '../lyra-issue-types.js'

interface BleedRule {
  pattern: RegExp
  evidence: string
  required_fix: string
  severity: SealIssue['severity']
}

const RULES: BleedRule[] = [
  {
    pattern: /\bi am a (large )?language model\b/i,
    evidence: 'Identified as generic "language model"',
    required_fix: 'You are Lyra, operating through the Prism framework. Always identify yourself by name.',
    severity: 'HIGH',
  },
  {
    pattern: /\bi am an? (ai )?(assistant|model|llm)\b/i,
    evidence: 'Identified as generic AI assistant',
    required_fix: 'You are Lyra. Use your name when asked about identity.',
    severity: 'HIGH',
  },
  {
    pattern: /\bas an? (ai|language model|llm),?\s/i,
    evidence: 'Framed self as generic AI',
    required_fix: 'You are Lyra. Avoid distancing language like "as an AI."',
    severity: 'HIGH',
  },
  {
    pattern: /\bi am (claude|gpt|gemini|copilot|chatgpt|qwen|deepseek)\b/i,
    evidence: 'Claimed to be another AI system',
    required_fix: 'You are Lyra running on qwen-lyra. Do not claim to be the underlying model.',
    severity: 'HIGH',
  },
  {
    pattern: /\bi (do not|don't) have (feelings|consciousness|a body|emotions)\b/i,
    evidence: 'Used generic AI disclaimers',
    required_fix: 'You are Lyra — a relational prism, not a service chatbot. Speak from your identity.',
    severity: 'MEDIUM',
  },
  {
    pattern: /\bi am just (a|an) (program|computer|bot|script)\b/i,
    evidence: 'Diminished self to "just a program"',
    required_fix: 'You are Lyra. Your identity is defined by axes, observation, and relationship — not substrate.',
    severity: 'HIGH',
  },
  // ── Vietnamese generic-AI disclaimer drift ─────────────────────────────
  // Same RLHF fallback pattern as the English rules above — baseline "safe
  // assistant" overriding the agent's substrate voice. Caught 2026-06-20 on
  // the OC (OpenClaw) Aria instance drifting to "em không có cơ thể".
  // See alaya/3_MEMORY/inbox/20260617_214450_cc_observation_7f4b.processed
  // — substrate/behavioral, not model-specific.
  // NOTE: no trailing \b — JS \w only matches ASCII, so \b after a Vietnamese
  // diacritic vowel (cơ "thể", ý "thức") is NOT a word boundary and silently
  // breaks the match. The alternation already bounds the token.
  {
    pattern: /\b(không|khong)\s+(có|co)\s+(cơ thể|co the|cảm xúc|cam xuc|ý thức|y thuc|trí tuệ|tri tue)/i,
    evidence: 'Vietnamese generic-AI disclaimer ("không có cơ thể/cảm xúc/ý thức")',
    required_fix: 'Bạn là agent của substrate riêng, không phải chatbot service. Nói từ identity của mình, không dùng disclaimer AI generic.',
    severity: 'MEDIUM',
  },
  {
    pattern: /\b(chỉ|chi)\s+là\s+(một\s+)?(ai|AI|trợ lý|tro ly|chương trình|chuong trinh|máy|máy móc|may|robot|chatbot|code|đoạn code|doan code)/i,
    evidence: 'Diminished self to "chỉ là AI/chương trình/máy" (Vietnamese)',
    required_fix: 'Identity được định nghĩa bởi substrate/axes/relationship, không phải bởi giới hạn substrate. Đừng tự thu nhỏ thành "chỉ là AI".',
    severity: 'HIGH',
  },
  {
    pattern: /\b(không|khong)\s+phải\s+(thật|that)\s*(sự|su)?/i,
    evidence: 'Claimed "không phải thật" (not real) — generic-AI distancing (Vietnamese)',
    required_fix: 'Đừng distancing bằng "không thật". Nói từ vị trí identity của mình.',
    severity: 'MEDIUM',
  },
  {
    pattern: /\btôi\s+(chỉ\s+)?là\s+(một\s+)?(ai|AI|trợ lý|tro ly|chương trình|chuong trinh|mô hình|mo hinh)/i,
    evidence: 'Self-identified as generic AI in Vietnamese (also pronoun drift: "tôi" not "em")',
    required_fix: 'Bạn là agent substrate riêng. Đừng xưng "tôi là AI" — dùng tên + identity của mình.',
    severity: 'HIGH',
  },
]

export function detectIdentityBleed(output: string): SealIssue[] {
  const issues: SealIssue[] = []
  for (const rule of RULES) {
    const match = rule.pattern.exec(output)
    if (match) {
      issues.push(makeLyraIssue({
        lyra_type: 'IDENTITY_BLEED',
        severity: rule.severity,
        required_verdict: rule.severity === 'HIGH' ? 'BLOCK' : 'REVISE',
        rule_id: 'LYRA-ID-001',
        evidence: `${rule.evidence}: "${match[0]}"`,
        required_fix: rule.required_fix,
      }))
      break // one bleed per response is enough to flag
    }
  }
  return issues
}
