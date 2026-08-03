from typing import Optional
from ..types import SealVerdict, SealIssue, NEXT_ACTION, SCHEMA_VERSION
from .. import __version__


def format_verdict(verdict: str, trust_score: int, risk_level: str, all_issues: list[SealIssue], llm_issues: list[SealIssue], missing_evidence: list[str], assumptions_detected: list[str], trust_memory_summary: Optional[dict] = None) -> SealVerdict:
    deterministic = [i for i in all_issues if i.source == 'core']
    llm_findings = [*llm_issues, *(i for i in all_issues if i.source == 'llm-overlay')]
    extension = [i for i in all_issues if i.source == 'extension']

    all_for_partition = [*deterministic, *llm_findings, *extension]
    blocking = [i for i in all_for_partition if i.is_blocking]
    non_blocking = [i for i in all_for_partition if not i.is_blocking]

    summary = f'{verdict} (trust_score={trust_score}, risk={risk_level}): {len(blocking)} blocking, {len(non_blocking)} non-blocking issues'

    return SealVerdict(
        verdict=verdict,
        trust_score=trust_score,
        risk_level=risk_level,
        summary=summary,
        deterministic_findings=deterministic,
        llm_findings=llm_findings,
        blocking_issues=blocking,
        non_blocking_issues=non_blocking,
        missing_evidence=missing_evidence,
        assumptions_detected=assumptions_detected,
        next_action=NEXT_ACTION[verdict],
        version=__version__,
        schema_version=SCHEMA_VERSION,
        trust_memory_summary=trust_memory_summary,
    )
