import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from seal_gate import Seal
from seal_gate.engine.heuristic_scorer import is_ambiguous, AMBIGUOUS_THRESHOLD


def test_is_ambiguous_threshold():
    assert is_ambiguous(AMBIGUOUS_THRESHOLD) is False
    assert is_ambiguous(100) is False
    assert is_ambiguous(AMBIGUOUS_THRESHOLD - 1) is True
    assert is_ambiguous(0) is True


class _SpyAdapter:
    def __init__(self):
        self.calls = 0

    def review(self, input_data, partial):
        self.calls += 1
        return {
            'suspected_issues': [], 'missing_requirements': [],
            'possible_edge_cases': [], 'evidence_gaps': [],
            'risk_guess': 'LOW', 'confidence': 0.9,
        }


# Mirrors tests/engine/llm-auto-mode.test.ts (TS). Seal is a process-wide singleton with no
# public reset, so this test restores it to "no adapter" in `finally` to avoid leaking a
# throwing/spy adapter into other test files sharing this pytest run.
def test_auto_mode_skips_llm_when_score_unambiguous():
    spy = _SpyAdapter()
    Seal.with_llm(spy, mode='auto')
    try:
        verdict = Seal.review({
            'artifact_type': 'llm_response',
            'output': 'Implemented the login rate-limiting feature.',
            'spec': '',
            'evidence': {'test_log': '', 'build_log': '', 'diff': '', 'references': []},
            'risk_hint': None,
        })
        assert spy.calls == 0
        assert any('auto mode' in a for a in verdict.assumptions_detected)
    finally:
        Seal.with_llm(None)


def test_auto_mode_calls_llm_when_score_ambiguous():
    spy = _SpyAdapter()
    Seal.with_llm(spy, mode='auto')
    try:
        Seal.review({
            'artifact_type': 'llm_response',
            'output': 'All tests pass.',
            'spec': None,
            'evidence': {'test_log': '', 'build_log': '', 'diff': '', 'references': []},
            'risk_hint': None,
        })
        assert spy.calls > 0
    finally:
        Seal.with_llm(None)


def test_always_mode_default_unchanged():
    spy = _SpyAdapter()
    Seal.with_llm(spy)
    try:
        Seal.review({
            'artifact_type': 'llm_response',
            'output': 'Implemented the login rate-limiting feature.',
            'spec': '',
            'evidence': {'test_log': '', 'build_log': '', 'diff': '', 'references': []},
            'risk_hint': None,
        })
        assert spy.calls == 1
    finally:
        Seal.with_llm(None)
