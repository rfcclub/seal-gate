"""
MiniMax LLM Reviewer Adapter — v0.3
Uses MiniMax-M3 (tokenplan) as semantic reviewer for Seal Gate L2.

MiniMax is a SENSOR, not a judge. Returns structured signals.
PolicyEngine converts signals to SealIssue[] via deterministic rules.
"""
import json
import os
import urllib.request
import urllib.error
from ..types import SealInput, SealVerdict
from .sanitize_claim_input import wrap_untrusted_claim, UNTRUSTED_CLAIM_PREAMBLE

MINIMAX_BASE_URL = os.environ.get('MINIMAX_BASE_URL', 'https://api.minimax.io/v1')
MINIMAX_API_KEY = os.environ.get('MINIMAX_PLAN_KEY') or os.environ.get('MINIMAX_API_KEY', '')
DEFAULT_MODEL = os.environ.get('MINIMAX_MODEL', 'MiniMax-M3')

SYSTEM_PROMPT = """You are Seal, a quality gate in an AI engineering workflow.

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
- If output looks correct and complete, return empty arrays and high confidence.

""" + UNTRUSTED_CLAIM_PREAMBLE


def _build_user_message(input_data: dict, partial: dict) -> str:
    parts = []
    if input_data.get('spec'):
        parts.append(f"=== SPEC ===\n{input_data['spec']}")
    parts.append(f"=== OUTPUT (artifact_type: {input_data.get('artifact_type', 'unknown')}) ===\n{wrap_untrusted_claim(input_data.get('output', ''))}")
    blocking = [f for f in partial.get('deterministic_findings', []) if getattr(f, 'is_blocking', False)]
    if blocking:
        issues = '\n'.join(f"- [{getattr(f, 'rule_id', getattr(f, 'type', ''))}] {getattr(f, 'evidence', '')}" for f in blocking)
        parts.append(f"=== DETERMINISTIC FINDINGS (already flagged, do not repeat) ===\n{issues}")
    parts.append(f"=== PARTIAL VERDICT ===\ntrust_score: {partial.get('trust_score', 0)}, risk_level: {partial.get('risk_level', 'MEDIUM')}")
    return '\n\n'.join(parts)


class MinimaxLLMReviewer:
    def __init__(self, model: str = DEFAULT_MODEL, base_url: str = MINIMAX_BASE_URL, api_key: str = MINIMAX_API_KEY):
        self.model = model
        self.base_url = base_url
        self.api_key = api_key

    def review(self, input_data: dict, partial: dict) -> dict:
        if not self.api_key:
            raise ValueError('MINIMAX_PLAN_KEY or MINIMAX_API_KEY not set')

        payload = json.dumps({
            'model': self.model,
            'messages': [
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user', 'content': _build_user_message(input_data, partial)},
            ],
            'response_format': {'type': 'json_object'},
            'temperature': 0.1,
            'max_tokens': 1024,
        }).encode('utf-8')

        req = urllib.request.Request(
            f'{self.base_url}/chat/completions',
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {self.api_key}',
            },
            method='POST',
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:200]
            raise RuntimeError(f'MiniMax API error {e.code}: {body}')

        content = data.get('choices', [{}])[0].get('message', {}).get('content', '{}')

        # Strip <think>...</think> reasoning block if present (MiniMax-M3 thinking model)
        import re as _re
        content = _re.sub(r'<think>[\s\S]*?</think>', '', content).strip()

        # Extract JSON object from content
        m = _re.search(r'\{[\s\S]*\}', content)
        json_str = m.group(0) if m else content

        try:
            signals = json.loads(json_str)
        except json.JSONDecodeError:
            raise RuntimeError(f'MiniMax returned invalid JSON: {content[:200]}')

        valid_risks = {'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'}
        return {
            'suspected_issues':    signals.get('suspected_issues', []) if isinstance(signals.get('suspected_issues'), list) else [],
            'missing_requirements': signals.get('missing_requirements', []) if isinstance(signals.get('missing_requirements'), list) else [],
            'possible_edge_cases':  signals.get('possible_edge_cases', []) if isinstance(signals.get('possible_edge_cases'), list) else [],
            'evidence_gaps':        signals.get('evidence_gaps', []) if isinstance(signals.get('evidence_gaps'), list) else [],
            'risk_guess':           signals.get('risk_guess', 'MEDIUM') if signals.get('risk_guess') in valid_risks else 'MEDIUM',
            'confidence':           max(0.0, min(1.0, float(signals.get('confidence', 0.5)))) if isinstance(signals.get('confidence'), (int, float)) else 0.5,
        }


def create_minimax_reviewer(model: str = DEFAULT_MODEL) -> MinimaxLLMReviewer:
    """Create a pre-configured MiniMax reviewer for use with Seal.with_llm()."""
    return MinimaxLLMReviewer(model=model)
