from .types import SealInput, SealVerdict, SealIssue, SealEvidence, make_issue, max_verdict
from .errors import SealInputError
from .engine import input_normalizer, heuristic_scorer, policy_engine, verdict_formatter
from .detectors import claim_extractor, risk_classifier, evidence_gap_detector, evidence_checker
from .detectors import test_weakness_detector, confidence_language_detector, spec_coverage_detector


class _Seal:
    def __init__(self):
        import threading
        self._extensions: list = []
        self._llm_adapter = None
        self._lock = threading.Lock()

    def extend(self, ext) -> None:
        with self._lock:
            self._extensions.append(ext)

    def with_llm(self, adapter) -> None:
        with self._lock:
            self._llm_adapter = adapter

    def review(self, raw: dict) -> SealVerdict:
        # Snapshot mutable state under lock to avoid race conditions
        with self._lock:
            extensions = list(self._extensions)
            llm_adapter = self._llm_adapter

        inp = input_normalizer.normalize(raw)

        # Step 2: Claims
        claims = claim_extractor.extract_claims(inp.output)
        used_spans = claim_extractor.get_used_spans(claims)

        # Step 4: Risk
        risk_result = risk_classifier.classify_risk(inp.output, inp.evidence.diff, inp.risk_hint)
        risk_level = risk_result['risk_level']

        # Step 5: Evidence envelopes
        evidence_issues = evidence_checker.check_evidence(inp.evidence.references, mode='portable')

        # Step 6: Evidence gaps
        gap_result = evidence_gap_detector.detect_evidence_gaps(claims, inp.evidence, risk_level)

        # Step 7: Spec coverage
        spec_result = spec_coverage_detector.detect_spec_coverage(inp.spec, inp.output)

        # Step 8: Test weakness
        auth_flagged = 'RK-HIGH' in risk_result['matched_rules']
        test_result = test_weakness_detector.detect_test_weakness(inp.artifact_type, inp.output, risk_level, auth_flagged, inp.evidence)

        # Step 9: Confidence language
        conf_result = confidence_language_detector.detect_confidence_language(inp.output, risk_level, inp.evidence, used_spans)

        detector_findings: list[SealIssue] = [
            *evidence_issues,
            *gap_result['issues'], *spec_result['issues'],
            *test_result['issues'], *conf_result['issues'],
        ]

        # Step 10: Detector score
        class _D:
            def __init__(self, d): self.trust_deduction = d
        risk_ded = [_D(risk_result['trust_deduction'])] if risk_result['trust_deduction'] > 0 else []
        all_for_score = [f for f in detector_findings if getattr(f, 'trust_deduction', 0)] + risk_ded
        detector_score = heuristic_scorer.compute_detector_score(all_for_score)

        # Step 11: LLM reviewer (optional)
        llm_issues: list[SealIssue] = []
        assumptions = list(spec_result['assumptions'])

        llm_signals = None
        if llm_adapter:
            partial = {
                'trust_score': detector_score,
                'risk_level': risk_level,
                'deterministic_findings': detector_findings,
                'missing_evidence': gap_result['missing_evidence'],
                'assumptions_detected': assumptions,
            }
            try:
                llm_signals = llm_adapter.review(inp.__dict__ if hasattr(inp, '__dict__') else inp, partial)
                llm_issues = policy_engine.convert_llm_signals(llm_signals)
            except Exception:
                # Don't leak exception details into user-facing verdict
                detector_findings.append(make_issue(type='OTHER', severity='LOW', layer='L2', source='core', evidence='LLM reviewer failed — L2 unreviewed'))
                assumptions.append('L2 (semantic correctness) not reviewed — LLM reviewer error')
        else:  # no llm_adapter
            assumptions.append('L2 (semantic correctness) not reviewed — no LLM reviewer registered')
            detector_findings.append(make_issue(type='OTHER', severity='LOW', layer='L2', source='core', evidence='L2 unreviewed — semantic issues may exist'))

        # Step 12: Policy
        base_verdict = heuristic_scorer.verdict_from_score(detector_score, any(f.is_blocking for f in detector_findings))
        policy_result = policy_engine.apply_policy(base_verdict, inp, risk_level, [*detector_findings, *llm_issues], llm_signals)

        all_issues = [*detector_findings, *policy_result['injected_issues']]
        final_score = heuristic_scorer.compute_final_score(detector_score, policy_result['policy_deductions'])

        blocking = [i for i in all_issues if i.is_blocking]
        final_verdict = max_verdict(policy_result['verdict'], heuristic_scorer.verdict_from_score(final_score, blocking))
        if policy_result['verdict'] == 'BLOCK':
            final_verdict = 'BLOCK'

        # Step 13: Extensions
        for ext in extensions:
            try:
                ext_issues = ext.check(inp.__dict__ if not isinstance(inp, dict) else inp)
                all_issues.extend(ext_issues)
                if any(getattr(i, 'required_verdict', None) == 'BLOCK' and i.is_blocking for i in ext_issues):
                    final_verdict = 'BLOCK'
                elif any(i.is_blocking for i in ext_issues):
                    final_verdict = max_verdict(final_verdict, 'REVISE')
            except Exception as e:
                all_issues.append(make_issue(type='OTHER', severity='LOW', layer='EXTENSION', source='extension', evidence=f'Extension failed: {e}'))

        # Step 14: Format
        return verdict_formatter.format_verdict(
            final_verdict, final_score, risk_level, all_issues, llm_issues,
            gap_result['missing_evidence'], assumptions
        )


Seal = _Seal()
__all__ = ['Seal', 'SealInputError', 'SealVerdict']
