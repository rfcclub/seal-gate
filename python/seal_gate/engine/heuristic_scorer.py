import math
from ..types import SealIssue, VERDICT_ORDER

# Mirrors src/engine/heuristic-scorer.ts AMBIGUOUS_THRESHOLD — used by Seal.with_llm(mode='auto').
AMBIGUOUS_THRESHOLD = 85


def is_ambiguous(score: int) -> bool:
    return score < AMBIGUOUS_THRESHOLD


def verdict_from_score(score: int, has_blocking: bool) -> str:
    base = score_to_verdict(score)
    if has_blocking:
        idx = max(VERDICT_ORDER.index(base), VERDICT_ORDER.index('REVISE'))
        return VERDICT_ORDER[idx]
    return base


def score_to_verdict(score: int) -> str:
    if score >= 85: return 'PASS'
    if score >= 70: return 'PASS_WITH_WARNINGS'
    if score >= 50: return 'REVISE'
    if score >= 30: return 'ESCALATE_TO_HUMAN'
    return 'BLOCK'


def compute_detector_score(findings: list) -> int:
    total = sum(getattr(f, 'trust_deduction', 0) or 0 for f in findings)
    return max(0, min(100, math.floor(100 - total)))


def compute_final_score(detector_score: int, policy_deductions: int) -> int:
    return max(0, min(100, math.floor(detector_score - policy_deductions)))
