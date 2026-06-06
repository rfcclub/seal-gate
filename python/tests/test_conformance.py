import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from seal_gate import Seal
from seal_gate.trust_memory import TrustMemory, compute_reliability_score, get_drift_trend, ReviewRecord

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), '../../tests/conformance/fixtures')


def load_fixtures():
    fixtures = []
    for fname in sorted(os.listdir(FIXTURES_DIR)):
        if fname.endswith('.json'):
            with open(os.path.join(FIXTURES_DIR, fname)) as f:
                data = json.load(f)
            fixtures.append((fname.replace('.json', ''), data))
    return fixtures


def test_review_conformance():
    for name, fixture in load_fixtures():
        if 'input' not in fixture:
            continue  # skip non-review fixtures (e.g. trust-memory)
        inp = fixture['input']
        expected = fixture['expected']
        verdict = Seal.review(inp)
        assert verdict.verdict == expected['verdict'], f'{name}: verdict {verdict.verdict!r} != {expected["verdict"]!r}'
        assert verdict.trust_score == expected['trust_score'], f'{name}: trust_score {verdict.trust_score} != {expected["trust_score"]}'
        assert verdict.risk_level == expected['risk_level'], f'{name}: risk_level {verdict.risk_level!r} != {expected["risk_level"]!r}'
        assert len(verdict.blocking_issues) == expected['blocking_count'], f'{name}: blocking_count {len(verdict.blocking_issues)} != {expected["blocking_count"]}'
        print(f'  ✓ {name}: {verdict.verdict} (score={verdict.trust_score})')


def test_trust_memory_conformance():
    fixture_path = os.path.join(FIXTURES_DIR, 'trust-memory.json')
    with open(fixture_path) as f:
        fixture = json.load(f)

    records = [ReviewRecord(**r) for r in fixture['records']]
    expected = fixture['expected']

    score = compute_reliability_score(records)
    trend = get_drift_trend(records)

    assert score == expected['reliability_score'], f'reliability_score {score} != {expected["reliability_score"]}'
    assert trend == expected['drift_trend'], f'drift_trend {trend!r} != {expected["drift_trend"]!r}'
    print(f'  ✓ trust-memory: score={score}, trend={trend}')


if __name__ == '__main__':
    print('Running Python conformance tests...')
    test_review_conformance()
    test_trust_memory_conformance()
    print('All conformance tests passed!')
