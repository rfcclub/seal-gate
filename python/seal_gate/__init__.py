from .types import SealInput, SealVerdict, SealIssue, SealEvidence, make_issue, max_verdict
from .errors import SealInputError
from .engine import input_normalizer, heuristic_scorer, policy_engine, verdict_formatter
from .detectors import claim_extractor, risk_classifier, evidence_gap_detector
from .detectors import test_weakness_detector, confidence_language_detector, spec_coverage_detector


class _Seal:
    def __init__(self):
        self._extensions: list = []
        self._llm_adapter = None

    def extend(self, ext) -> None:
        self._extensions.append(ext)

    def review(self, raw: dict) -> SealVerdict:
        inp = input_normalizer.normalize(raw)

        claims = claim_extractor.extract_claims(inp.output)
        used_spans = claim_extractor.get_used_spans(claims)

        risk_result = risk_classifier.classify_risk(inp.output, inp.evidence.diff, inp.risk_hint)
        risk_level = risk_result['risk_level']

        gap_result = evidence_gap_detector.detect_evidence_gaps(claims, inp.evidence)
        spec_result = spec_coverage_detector.detect_spec_coverage(inp.spec, inp.output)

        auth_flagged = 'RK-HIGH' in risk_result['matched_rules']
        test_result = test_weakness_detector.detect_test_weakness(inp.artifact_type, inp.output, risk_level, auth_flagged, inp.evidence)

        conf_result = confidence_language_detector.detect_confidence_language(inp.output, risk_level, inp.evidence, used_spans)

        detector_findings: list[SealIssue] = [
            *gap_result['issues'], *spec_result['issues'],
            *test_result['issues'], *conf_result['issues'],
        ]

        class _D:
            def __init__(self, d): self.trust_deduction = d
        risk_ded = [_D(risk_result['trust_deduction'])] if risk_result['trust_deduction'] > 0 else []
        all_for_score = [f for f in detector_findings if getattr(f, 'trust_deduction', 0)] + risk_ded
        detector_score = heuristic_scorer.compute_detector_score(all_for_score)

        llm_issues: list[SealIssue] = []
        assumptions = list(spec_result['assumptions'])
        assumptions.append('L2 (semantic correctness) not reviewed — no LLM reviewer registered')
        detector_findings.append(make_issue(type='OTHER', severity='LOW', layer='L2', source='core', evidence='L2 unreviewed — semantic issues may exist'))

        base_verdict = heuristic_scorer.verdict_from_score(detector_score, any(f.is_blocking for f in detector_findings))
        policy_result = policy_engine.apply_policy(base_verdict, inp, risk_level, [*detector_findings, *llm_issues])

        all_issues = [*detector_findings, *policy_result['injected_issues']]
        final_score = heuristic_scorer.compute_final_score(detector_score, policy_result['policy_deductions'])

        blocking = [i for i in all_issues if i.is_blocking]
        final_verdict = max_verdict(policy_result['verdict'], heuristic_scorer.verdict_from_score(final_score, blocking))
        if policy_result['verdict'] == 'BLOCK':
            final_verdict = 'BLOCK'

        return verdict_formatter.format_verdict(
            final_verdict, final_score, risk_level, all_issues, llm_issues,
            gap_result['missing_evidence'], assumptions
        )


Seal = _Seal()
__all__ = ['Seal', 'SealInputError', 'SealVerdict']
