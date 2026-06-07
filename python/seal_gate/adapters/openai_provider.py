"""
GenericOpenAIProvider — config-driven LLM reviewer.
Reads provider config from ~/.anima/providers.d/<name>.yaml.
Resolves ${ENV_VAR} in apiKey automatically.
Auto-appends /chat/completions to baseUrl.

Usage:
    from seal_gate.adapters.openai_provider import create_reviewer_from_provider, GenericOpenAIProvider
    Seal.with_llm(create_reviewer_from_provider('minimax'))
    Seal.with_llm(create_reviewer_from_provider('xiaomi'))
    Seal.with_llm(GenericOpenAIProvider(base_url='http://localhost:3546/v1', model='local', api_key='none'))
"""
import json
import os
import re
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

SYSTEM_PROMPT = """You are Seal, a quality gate in an AI engineering workflow.

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

confidence: 0.0–1.0. Empty arrays if output is correct. No padding."""


def _resolve_env_ref(value: str) -> str:
    return re.sub(r'\$\{([^}]+)\}', lambda m: os.environ.get(m.group(1), ''), value)


def _extract_json(raw: str) -> str:
    stripped = re.sub(r'<think>[\s\S]*?</think>', '', raw).strip()
    m = re.search(r'\{[\s\S]*\}', stripped)
    return m.group(0) if m else stripped


def _build_message(input_data: dict, partial: dict) -> str:
    parts = []
    if input_data.get('spec'):
        parts.append(f"=== SPEC ===\n{input_data['spec']}")
    parts.append(f"=== OUTPUT ({input_data.get('artifact_type', 'unknown')}) ===\n{input_data.get('output', '')}")
    blocking = [f for f in partial.get('deterministic_findings', []) if getattr(f, 'is_blocking', False)]
    if blocking:
        flagged = '\n'.join(f"- [{getattr(f,'rule_id',getattr(f,'type',''))}] {getattr(f,'evidence','')}" for f in blocking)
        parts.append(f"=== ALREADY FLAGGED ===\n{flagged}")
    parts.append(f"=== PARTIAL VERDICT ===\ntrust_score: {partial.get('trust_score',0)}, risk: {partial.get('risk_level','MEDIUM')}")
    return '\n\n'.join(parts)


def load_provider_config(name: str, model_index: int = 0) -> dict:
    """Load ~/.anima/providers.d/<name>.yaml and return {base_url, model, api_key}."""
    path = Path.home() / '.anima' / 'providers.d' / f'{name}.yaml'
    if not path.exists():
        raise FileNotFoundError(f'Provider config not found: {path}')

    raw = path.read_text()

    def get(key: str) -> str:
        m = re.search(rf'^{key}:\s*(.+)$', raw, re.M)
        return m.group(1).strip().strip('"\'') if m else ''

    base_url = get('baseUrl')
    raw_key  = get('apiKey')
    api_key  = _resolve_env_ref(raw_key)

    models = [m.group(1).strip() for m in re.finditer(r'^\s+-\s+id:\s+(.+)$', raw, re.M)]
    model = models[model_index] if models else 'default'

    if not base_url:
        raise ValueError(f'Provider {name}: baseUrl missing')

    return {'base_url': base_url, 'model': model, 'api_key': api_key}


class GenericOpenAIProvider:
    def __init__(self, base_url: str, model: str, api_key: str, timeout: int = 30):
        # Auto-append /chat/completions if not already present
        if base_url.endswith('/chat/completions'):
            self._endpoint = base_url
        else:
            self._endpoint = base_url.rstrip('/') + '/chat/completions'
        self._model   = model
        self._api_key = api_key
        self._timeout = timeout

    def review(self, input_data: dict, partial: dict) -> dict:
        payload = json.dumps({
            'model': self._model,
            'messages': [
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user',   'content': _build_message(input_data, partial)},
            ],
            'response_format': {'type': 'json_object'},
            'temperature': 0.1,
            'max_tokens': 1024,
        }).encode('utf-8')

        req = urllib.request.Request(
            self._endpoint,
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {self._api_key}' if self._api_key else 'Bearer none',
            },
            method='POST',
        )

        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                data = json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'[{self._model}] {e.code}: {e.read().decode()[:200]}')

        raw = data.get('choices', [{}])[0].get('message', {}).get('content', '{}')

        try:
            signals = json.loads(_extract_json(raw))
        except json.JSONDecodeError:
            raise RuntimeError(f'[{self._model}] invalid JSON: {raw[:200]}')

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


def create_reviewer_from_provider(name: str, model_index: int = 0, timeout: int = 30) -> GenericOpenAIProvider:
    """Load provider from ~/.anima/providers.d/<name>.yaml and return reviewer."""
    cfg = load_provider_config(name, model_index)
    return GenericOpenAIProvider(base_url=cfg['base_url'], model=cfg['model'],
                                 api_key=cfg['api_key'], timeout=timeout)
