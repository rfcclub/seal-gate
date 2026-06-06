import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from seal_gate.trust_memory import TrustMemory, compute_reliability_score, get_drift_trend, ReviewRecord


def _r(verdict: str, trust_score: int, risk_level: str = 'MEDIUM', blocking_count: int = 0, ts: int = None) -> ReviewRecord:
    return ReviewRecord(ts=ts or int(time.time() * 1000), verdict=verdict, trust_score=trust_score,
                        risk_level=risk_level, blocking_count=blocking_count)


# ── TrustMemory ──────────────────────────────────────────────────────────────

def test_new_agent_no_history():
    mem = TrustMemory()
    assert mem.get_score('x') is None
    assert mem.get_history('x') == []

def test_record_adds_entry():
    mem = TrustMemory()
    mem.record('aria', 'PASS', 100, 'LOW', 0)
    assert len(mem.get_history('aria')) == 1
    assert mem.get_history('aria')[0].verdict == 'PASS'

def test_history_capped():
    mem = TrustMemory(max_history=3)
    for _ in range(5):
        mem.record('aria', 'PASS', 100, 'LOW', 0)
    assert len(mem.get_history('aria')) == 3

def test_most_recent_kept_on_cap():
    mem = TrustMemory(max_history=2)
    mem.record('aria', 'BLOCK', 10, 'CRITICAL', 5)
    mem.record('aria', 'PASS', 95, 'LOW', 0)
    mem.record('aria', 'PASS_WITH_WARNINGS', 75, 'MEDIUM', 0)
    h = mem.get_history('aria')
    assert len(h) == 2
    assert h[0].verdict == 'PASS'
    assert h[1].verdict == 'PASS_WITH_WARNINGS'

def test_get_score_returns_number():
    mem = TrustMemory()
    mem.record('aria', 'PASS', 100, 'LOW', 0)
    score = mem.get_score('aria')
    assert score is not None
    assert 0 <= score <= 100

def test_get_summary_fields():
    mem = TrustMemory()
    mem.record('aria', 'PASS', 95, 'LOW', 0)
    s = mem.get_summary('aria')
    assert s.agent_id == 'aria'
    assert s.reliability_score is not None
    assert s.drift_trend in ('improving', 'stable', 'degrading')
    assert s.review_count == 1

def test_unknown_agent_summary():
    mem = TrustMemory()
    s = mem.get_summary('ghost')
    assert s.reliability_score is None
    assert s.drift_trend == 'stable'
    assert s.review_count == 0

def test_to_dict_from_dict_roundtrip():
    mem = TrustMemory()
    mem.record('aria', 'PASS', 95, 'LOW', 0)
    mem.record('aria', 'REVISE', 55, 'HIGH', 1)
    data = mem.to_dict()
    mem2 = TrustMemory.from_dict(data)
    assert len(mem2.get_history('aria')) == 2
    assert mem2.get_history('aria')[0].verdict == 'PASS'


# ── compute_reliability_score ────────────────────────────────────────────────

def test_all_pass_score_high():
    records = [_r('PASS', 100) for _ in range(5)]
    assert compute_reliability_score(records) >= 90

def test_all_block_score_low():
    records = [_r('BLOCK', 5) for _ in range(5)]
    assert compute_reliability_score(records) <= 15

def test_mixed_verdicts_between_extremes():
    records = [_r('PASS', 100), _r('BLOCK', 10)]
    score = compute_reliability_score(records)
    assert 10 < score < 90

def test_recent_weighted_higher():
    now = int(time.time() * 1000)
    records = [
        _r('BLOCK', 5, ts=now - 7 * 86400000),
        _r('BLOCK', 5, ts=now - 6 * 86400000),
        _r('PASS', 100, ts=now - 3600000),
        _r('PASS', 100, ts=now - 1800000),
        _r('PASS', 100, ts=now - 600000),
    ]
    assert compute_reliability_score(records) > 50

def test_empty_returns_none():
    assert compute_reliability_score([]) is None


# ── get_drift_trend ──────────────────────────────────────────────────────────

def test_improving_trend():
    now = int(time.time() * 1000)
    records = [_r('BLOCK', 10, ts=now-5000), _r('REVISE', 55, ts=now-4000),
               _r('PASS', 90, ts=now-3000), _r('PASS', 95, ts=now-2000)]
    assert get_drift_trend(records) == 'improving'

def test_degrading_trend():
    now = int(time.time() * 1000)
    records = [_r('PASS', 95, ts=now-5000), _r('PASS', 90, ts=now-4000),
               _r('REVISE', 55, ts=now-3000), _r('BLOCK', 10, ts=now-2000)]
    assert get_drift_trend(records) == 'degrading'

def test_stable_trend():
    now = int(time.time() * 1000)
    records = [_r('PASS', 90, ts=now-4000), _r('PASS', 85, ts=now-3000),
               _r('PASS', 88, ts=now-2000), _r('PASS', 92, ts=now-1000)]
    assert get_drift_trend(records) == 'stable'

def test_too_few_records_stable():
    assert get_drift_trend([]) == 'stable'
    assert get_drift_trend([_r('PASS', 90)]) == 'stable'


# ── run all ──────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    tests = [(name, fn) for name, fn in globals().items() if name.startswith('test_')]
    passed = failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f'  ✓ {name}')
            passed += 1
        except Exception as e:
            print(f'  ✗ {name}: {e}')
            failed += 1
    print(f'\n{passed} passed, {failed} failed')
    if failed:
        import sys; sys.exit(1)
