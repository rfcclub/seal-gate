import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from seal_gate.detectors.claim_extractor import extract_claims, get_used_spans
from seal_gate.detectors.risk_classifier import classify_risk
from seal_gate.detectors.evidence_gap_detector import detect_evidence_gaps
from seal_gate.detectors.evidence_checker import check_evidence
from seal_gate.detectors.test_weakness_detector import detect_test_weakness
from seal_gate.detectors.confidence_language_detector import detect_confidence_language
from seal_gate.detectors.spec_coverage_detector import detect_spec_coverage
from seal_gate.types import SealEvidence


# ── ClaimExtractor ───────────────────────────────────────────────────────────

def test_claim_extractor_test_result():
    claims = extract_claims('All tests pass.')
    assert any(c.type == 'test_result_claim' for c in claims)

def test_claim_extractor_build():
    claims = extract_claims('Build succeeded.')
    assert any(c.type == 'build_claim' for c in claims)

def test_claim_extractor_implementation():
    claims = extract_claims('I implemented the feature.')
    assert any(c.type == 'implementation_claim' for c in claims)

def test_claim_extractor_risk():
    claims = extract_claims('This change is secure.')
    assert any(c.type == 'risk_claim' for c in claims)

def test_claim_extractor_generic_fully():
    claims = extract_claims('This is fully done.')
    assert any(c.type == 'generic_claim' for c in claims)

def test_claim_extractor_generic_completely():
    claims = extract_claims('This is completely safe.')
    # 'completely' matches generic_claim; 'safe' matches risk_claim — dedup keeps first
    types = [c.type for c in claims]
    assert 'generic_claim' in types or 'risk_claim' in types

def test_claim_extractor_ignores_code_block():
    claims = extract_claims('```\nall tests pass\n```')
    assert len(claims) == 0

def test_claim_extractor_ignores_inline_code():
    claims = extract_claims('Use `tested` as a parameter')
    assert len(claims) == 0

def test_claim_extractor_sorted_by_pos():
    claims = extract_claims('Build succeeded and all tests pass.')
    positions = [c.start_pos for c in claims]
    assert positions == sorted(positions)

def test_claim_extractor_all_require_evidence():
    claims = extract_claims('implemented and tested')
    assert all(c.requires_evidence for c in claims)


# ── RiskClassifier ───────────────────────────────────────────────────────────

def test_risk_critical_drop_table():
    r = classify_risk('We will DROP TABLE users', '', None)
    assert r['risk_level'] == 'CRITICAL'
    assert r['trust_deduction'] == 20

def test_risk_high_auth():
    r = classify_risk('Changed auth logic', '', None)
    assert r['risk_level'] == 'HIGH'
    assert 'RK-HIGH' in r['matched_rules']

def test_risk_critical_and_high_both_detected():
    # Bug fix: CRITICAL+HIGH input should detect both
    r = classify_risk('Payment flow with JWT token', '', None)
    assert r['risk_level'] == 'CRITICAL'
    assert 'RK-HIGH' in r['matched_rules']  # auth also detected

def test_risk_hint_elevates():
    r = classify_risk('minor change', '', 'CRITICAL')
    assert r['risk_level'] == 'CRITICAL'

def test_risk_default_medium():
    r = classify_risk('Updated README', '', None)
    assert r['risk_level'] == 'MEDIUM'


# ── EvidenceGapDetector ──────────────────────────────────────────────────────

def _ev(**kw):
    return SealEvidence(
        test_log=kw.get('test_log', ''),
        build_log=kw.get('build_log', ''),
        diff=kw.get('diff', ''),
        references=kw.get('references', []),
    )

def test_e001_test_claim_no_log():
    from seal_gate.detectors.claim_extractor import extract_claims
    claims = extract_claims('All tests pass.')
    result = detect_evidence_gaps(claims, _ev(), 'MEDIUM')
    assert any(i.rule_id == 'E001' for i in result['issues'])
    assert result['trust_deductions'] >= 20

def test_e001_not_fired_with_test_log():
    from seal_gate.detectors.claim_extractor import extract_claims
    claims = extract_claims('All tests pass.')
    result = detect_evidence_gaps(claims, _ev(test_log='PASS: 42 tests'), 'MEDIUM')
    assert not any(i.rule_id == 'E001' for i in result['issues'])

def test_e004_not_fired_for_low_risk():
    from seal_gate.detectors.claim_extractor import extract_claims
    claims = extract_claims('This is production-ready.')
    result = detect_evidence_gaps(claims, _ev(), 'LOW')
    assert not any(i.rule_id == 'E004' for i in result['issues'])

def test_e004_fired_for_medium_risk():
    from seal_gate.detectors.claim_extractor import extract_claims
    claims = extract_claims('This is production-ready.')
    result = detect_evidence_gaps(claims, _ev(), 'MEDIUM')
    assert any(i.rule_id == 'E004' for i in result['issues'])


# ── EvidenceChecker ──────────────────────────────────────────────────────────

def test_evidence_checker_valid_file_portable():
    issues = check_evidence([{'type': 'file', 'path': 'src/index.ts', 'line': 1, 'snapshot': 'x'}], 'portable')
    assert len(issues) == 0

def test_evidence_checker_invalid_command_missing_output():
    issues = check_evidence([{'type': 'command', 'command': 'npm test', 'exit_code': 0, 'output': ''}], 'portable')
    assert len(issues) > 0

def test_evidence_checker_valid_memory():
    issues = check_evidence([{'type': 'memory', 'memory_key': 'k', 'retrieved_at': 't', 'content_snapshot': 'c'}], 'portable')
    assert len(issues) == 0


# ── TestWeaknessDetector ─────────────────────────────────────────────────────

def test_tw201_code_diff_no_tests():
    result = detect_test_weakness('code_diff', 'Added retry logic', 'MEDIUM', False, _ev())
    assert any(i.rule_id == 'TW201' for i in result['issues'])

def test_tw201_not_fired_for_design():
    result = detect_test_weakness('design', 'Architecture doc', 'LOW', False, _ev())
    assert not any(i.rule_id == 'TW201' for i in result['issues'])

def test_tw202_happy_path_only():
    result = detect_test_weakness('code_diff', 'Added feature', 'HIGH', False, _ev(test_log='PASS: happy path'))
    assert any(i.rule_id == 'TW202' for i in result['issues'])

def test_tw204_retry_no_failure_test():
    result = detect_test_weakness('code_diff', 'Added exponential backoff retry', 'MEDIUM', False, _ev(test_log='PASS: basic test'))
    assert any(i.rule_id == 'TW204' for i in result['issues'])

def test_tw205_auth_no_unauthorized_test():
    result = detect_test_weakness('code_diff', 'Updated auth', 'HIGH', True, _ev(test_log='PASS: login test'))
    assert any(i.rule_id == 'TW205' for i in result['issues'])


# ── ConfidenceLanguageDetector ───────────────────────────────────────────────

def test_cl401_overconfident_no_evidence():
    result = detect_confidence_language('This is definitely correct.', 'HIGH', _ev(), set())
    assert any(i.rule_id == 'CL401' for i in result['issues'])

def test_cl401_not_fired_with_evidence():
    result = detect_confidence_language('Definitely correct.', 'HIGH', _ev(test_log='PASS'), set())
    assert not any(i.rule_id == 'CL401' for i in result['issues'])

def test_cl402_hedging_high_risk():
    result = detect_confidence_language('This should work.', 'HIGH', _ev(), set())
    assert any(i.rule_id == 'CL402' for i in result['issues'])


# ── SpecCoverageDetector ─────────────────────────────────────────────────────

def test_spec_skipped_when_null():
    result = detect_spec_coverage(None, 'output')
    assert 'No spec provided' in result['assumptions'][0]
    assert len(result['issues']) == 0

def test_spec_criterion_missing():
    spec = '- authentication must be verified\n- tests must pass'
    result = detect_spec_coverage(spec, 'Updated README only')
    assert len(result['issues']) > 0


# ── run all ──────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import inspect
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
        sys.exit(1)
