import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from seal_gate import Seal

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), '../../tests/conformance/fixtures')


def load_fixtures():
    fixtures = []
    for fname in os.listdir(FIXTURES_DIR):
        if fname.endswith('.json'):
            with open(os.path.join(FIXTURES_DIR, fname)) as f:
                data = json.load(f)
            fixtures.append((fname.replace('.json', ''), data))
    return fixtures


def test_conformance():
    for name, fixture in load_fixtures():
        inp = fixture['input']
        expected = fixture['expected']
        verdict = Seal.review(inp)
        assert verdict.verdict == expected['verdict'], f'{name}: verdict {verdict.verdict!r} != {expected["verdict"]!r}'
        assert verdict.trust_score == expected['trust_score'], f'{name}: trust_score {verdict.trust_score} != {expected["trust_score"]}'
        assert verdict.risk_level == expected['risk_level'], f'{name}: risk_level {verdict.risk_level!r} != {expected["risk_level"]!r}'
        assert len(verdict.blocking_issues) == expected['blocking_count'], f'{name}: blocking_count {len(verdict.blocking_issues)} != {expected["blocking_count"]}'
        print(f'  ✓ {name}: {verdict.verdict} (score={verdict.trust_score})')


if __name__ == '__main__':
    print('Running Python conformance tests...')
    test_conformance()
    print('All conformance tests passed!')
