"""
Generic OpenAI-compatible LLM Reviewer Adapter
Works with any provider: MiniMax, Fireworks, Gemini, Qwen/MiMo, local (port 3546).

Usage:
    from seal_gate.adapters.generic_llm_reviewer import create_reviewer, create_minimax_reviewer
    Seal.with_llm(create_reviewer(provider='minimax'))
    Seal.with_llm(create_reviewer(provider='fireworks', model='accounts/...'))
    Seal.with_llm(create_reviewer(base_url='http://localhost:3546/v1', api_key='none', model='local'))
"""
import json
import os
import re
import urllib.request
import urllib.error
from typing import Optional
from .sanitize_claim_input import wrap_untrusted_claim, UNTRUSTED_CLAIM_PREAMBLE

PROVIDERS = {
    'minimax':   {'base_url': 'https://api.minimax.io/v1',               'api_key_env': 'MINIMAX_PLAN_KEY',    'default_model': 'MiniMax-M3'},
    'fireworks': {'base_url': 'https://api.fireworks.ai/inference/v1',   'api_key_env': 'FIREWORKS_API_KEY',   'default_model': 'accounts/fireworks/models/mixtral-8x7b-instruct'},
    'gemini':    {'base_url': 'https://generativelanguage.googleapis.com/v1beta/openai', 'api_key_env': 'GEMINI_API_KEY', 'default_model': 'gemini-2.0-flash'},
    'xiaomimo':  {'base_url': 'https://token-plan-sgp.xiaomimimo.com/v1', 'api_key_env': 'XIAOMI_MIMO_API_KEY', 'default_model': 'mimo-v2.5-pro'},
    'openai':    {'base_url': 'https://api.openai.com/v1',               'api_key_env': 'OPENAI_API_KEY',      'default_model': 'gpt-4o-mini'},
    'local':     {'base_url': 'http://localhost:3546/v1',                'api_key_env': '',                    'default_model': 'local'},
}

SYSTEM_PROMPT = """You are Seal, a quality gate in an AI engineering workflow.

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

Rules: confidence 0.0–1.0. Empty arrays if output is correct. No padding.

""" + UNTRUSTED_CLAIM_PREAMBLE


def _build_message(input_data: dict, partial: dict) -> str:
    parts = []
    if input_data.get('spec'):
        parts.append(f"=== SPEC ===\n{input_data['spec']}")
    parts.append(f"=== OUTPUT ({input_data.get('artifact_type', 'unknown')}) ===\n{wrap_untrusted_claim(input_data.get('output', ''))}")
    blocking = [f for f in partial.get('deterministic_findings', []) if getattr(f, 'is_blocking', False)]
    if blocking:
        flagged = '\n'.join(f"- [{getattr(f, 'rule_id', getattr(f, 'type', ''))}] {getattr(f, 'evidence', '')}" for f in blocking)
        parts.append(f"=== ALREADY FLAGGED (do not repeat) ===\n{flagged}")
    parts.append(f"=== PARTIAL VERDICT ===\ntrust_score: {partial.get('trust_score', 0)}, risk: {partial.get('risk_level', 'MEDIUM')}")
    return '\n\n'.join(parts)


def _extract_json(raw: str) -> str:
    stripped = re.sub(r'<think>[\s\S]*?</think>', '', raw).strip()
    m = re.search(r'\{[\s\S]*\}', stripped)
    return m.group(0) if m else stripped


class GenericLLMReviewer:
    def __init__(
        self,
        provider: Optional[str] = None,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: int = 30,
    ):
        preset = PROVIDERS.get(provider or 'minimax', PROVIDERS['minimax'])
        self.base_url = base_url or preset['base_url']
        self.api_key  = api_key or (os.environ.get(preset['api_key_env'], '') if preset['api_key_env'] else 'none')
        self.model    = model or preset['default_model']
        self.timeout  = timeout

    def review(self, input_data: dict, partial: dict) -> dict:
        payload = json.dumps({
            'model': self.model,
            'messages': [
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user',   'content': _build_message(input_data, partial)},
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
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'LLM reviewer {self.model} error {e.code}: {e.read().decode()[:200]}')

        raw = data.get('choices', [{}])[0].get('message', {}).get('content', '{}')
        json_str = _extract_json(raw)

        try:
            signals = json.loads(json_str)
        except json.JSONDecodeError:
            raise RuntimeError(f'LLM reviewer returned invalid JSON: {raw[:200]}')

        valid_risks = {'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'}
        confidence = signals.get('confidence', 0.5)
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
            confidence = 0.5

        return {
            'suspected_issues':     signals.get('suspected_issues', [])    if isinstance(signals.get('suspected_issues'), list)    else [],
            'missing_requirements': signals.get('missing_requirements', []) if isinstance(signals.get('missing_requirements'), list) else [],
            'possible_edge_cases':  signals.get('possible_edge_cases', [])  if isinstance(signals.get('possible_edge_cases'), list)  else [],
            'evidence_gaps':        signals.get('evidence_gaps', [])        if isinstance(signals.get('evidence_gaps'), list)        else [],
            'risk_guess':           signals.get('risk_guess', 'MEDIUM') if signals.get('risk_guess') in valid_risks else 'MEDIUM',
            'confidence':           max(0.0, min(1.0, float(confidence))),
        }


# Convenience factories
def create_reviewer(**kwargs) -> GenericLLMReviewer:
    return GenericLLMReviewer(**kwargs)

def create_minimax_reviewer(model: Optional[str] = None) -> GenericLLMReviewer:
    return GenericLLMReviewer(provider='minimax', model=model)

def create_fireworks_reviewer(model: Optional[str] = None) -> GenericLLMReviewer:
    return GenericLLMReviewer(provider='fireworks', model=model)

def create_gemini_reviewer(model: Optional[str] = None) -> GenericLLMReviewer:
    return GenericLLMReviewer(provider='gemini', model=model)

def create_mimo_reviewer(model: Optional[str] = None) -> GenericLLMReviewer:
    return GenericLLMReviewer(provider='xiaomimo', model=model)

def create_local_reviewer(model: Optional[str] = None) -> GenericLLMReviewer:
    return GenericLLMReviewer(provider='local', model=model)
