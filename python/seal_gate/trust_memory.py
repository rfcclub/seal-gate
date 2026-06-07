"""
Seal Gate v0.4 — Trust Memory
Cross-session agent reliability tracking: reliability score and drift trend.
Callers handle persistence via to_dict/from_dict.
"""
from __future__ import annotations
import math
import time
from dataclasses import dataclass, field
from typing import Optional

VERDICT_SCORE: dict[str, int] = {
    'PASS': 100,
    'PASS_WITH_WARNINGS': 80,
    'REVISE': 50,
    'ESCALATE_TO_HUMAN': 20,
    'BLOCK': 0,
}


@dataclass
class ReviewRecord:
    ts: int  # Unix ms
    verdict: str
    trust_score: int
    risk_level: str
    blocking_count: int

    def to_dict(self) -> dict:
        return {'ts': self.ts, 'verdict': self.verdict, 'trust_score': self.trust_score,
                'risk_level': self.risk_level, 'blocking_count': self.blocking_count}

    @staticmethod
    def from_dict(d: dict) -> 'ReviewRecord':
        return ReviewRecord(ts=d['ts'], verdict=d['verdict'], trust_score=d['trust_score'],
                            risk_level=d['risk_level'], blocking_count=d['blocking_count'])


@dataclass
class AgentSummary:
    agent_id: str
    reliability_score: Optional[int]
    drift_trend: str  # 'improving' | 'stable' | 'degrading'
    review_count: int
    last_reviewed_at: Optional[int]


def compute_reliability_score(records: list[ReviewRecord]) -> Optional[int]:
    """Weighted reliability score (recent reviews weighted higher). Returns None if no records."""
    if not records:
        return None
    n = len(records)
    total_weight = 0
    weighted_sum = 0.0
    for i, r in enumerate(records):
        weight = i + 1  # linear: oldest=1, most recent=n
        verdict_score = VERDICT_SCORE.get(r.verdict, 50)
        blended = verdict_score * 0.7 + r.trust_score * 0.3
        weighted_sum += blended * weight
        total_weight += weight
    # Use half-up rounding to match JS Math.round() (Python uses banker's rounding by default)
    return math.floor(weighted_sum / total_weight + 0.5)


def get_drift_trend(records: list[ReviewRecord], threshold: int = 15) -> str:
    """Split at time midpoint (not count midpoint) to avoid skew with clustered reviews."""
    if len(records) < 2:
        return 'stable'
    sorted_r = sorted(records, key=lambda r: r.ts)
    mid_ts = (sorted_r[0].ts + sorted_r[-1].ts) / 2
    first  = [r for r in sorted_r if r.ts <= mid_ts]
    second = [r for r in sorted_r if r.ts > mid_ts]
    if not first or not second:
        return 'stable'

    def avg(rs: list[ReviewRecord]) -> float:
        return sum(r.trust_score for r in rs) / len(rs)

    delta = avg(second) - avg(first)
    if delta > threshold:
        return 'improving'
    if delta < -threshold:
        return 'degrading'
    return 'stable'


def _sort_and_cap(records: list[ReviewRecord], max_history: int) -> list[ReviewRecord]:
    """Sort by ts and cap — for real-time record()."""
    return sorted(records, key=lambda r: r.ts)[-max_history:]


def _normalize_from_persistence(records: list[ReviewRecord], max_history: int) -> list[ReviewRecord]:
    """Sort, dedup same-ts (keep last), cap — for loading persisted data only."""
    sorted_r = sorted(records, key=lambda r: r.ts)
    seen: dict[int, ReviewRecord] = {}
    for r in sorted_r:
        seen[r.ts] = r
    return sorted(seen.values(), key=lambda r: r.ts)[-max_history:]


VALID_VERDICTS = {'PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'ESCALATE_TO_HUMAN', 'BLOCK'}


class TrustMemory:
    def __init__(self, max_history: int = 50, drift_threshold: int = 15):
        self._store: dict[str, list[ReviewRecord]] = {}
        self._max_history = max_history
        self._drift_threshold = drift_threshold

    def record(self, agent_id: str, verdict: str, trust_score: int,
               risk_level: str, blocking_count: int, ts: Optional[int] = None) -> None:
        if ts is not None:
            effective_ts = ts
        else:
            # Ensure monotonically increasing ts even within the same millisecond
            now_ms = int(time.time() * 1000)
            history = self._store.get(agent_id, [])
            last_ts = history[-1].ts if history else 0
            effective_ts = max(now_ms, last_ts + 1)
        r = ReviewRecord(ts=effective_ts, verdict=verdict,
                         trust_score=trust_score, risk_level=risk_level, blocking_count=blocking_count)
        history = self._store.setdefault(agent_id, [])
        history.append(r)
        self._store[agent_id] = _sort_and_cap(history, self._max_history)

    def get_history(self, agent_id: str) -> list[ReviewRecord]:
        return list(self._store.get(agent_id, []))

    def get_score(self, agent_id: str) -> Optional[int]:
        return compute_reliability_score(self._store.get(agent_id, []))

    def get_summary(self, agent_id: str) -> AgentSummary:
        history = self._store.get(agent_id, [])
        return AgentSummary(
            agent_id=agent_id,
            reliability_score=compute_reliability_score(history),
            drift_trend=get_drift_trend(history, self._drift_threshold),
            review_count=len(history),
            last_reviewed_at=history[-1].ts if history else None,
        )

    def to_dict(self) -> dict:
        return {agent_id: [r.to_dict() for r in records] for agent_id, records in self._store.items()}

    @staticmethod
    def from_dict(data: dict, max_history: int = 50, drift_threshold: int = 15) -> 'TrustMemory':
        mem = TrustMemory(max_history=max_history, drift_threshold=drift_threshold)
        for agent_id, records in data.items():
            if not isinstance(records, list):
                continue
            valid = []
            for r in records:
                if not isinstance(r, dict):
                    continue
                if not (isinstance(r.get('ts'), (int, float)) and
                        r.get('verdict') in VALID_VERDICTS and
                        isinstance(r.get('trust_score'), (int, float)) and
                        isinstance(r.get('risk_level'), str) and
                        isinstance(r.get('blocking_count'), (int, float))):
                    continue
                valid.append(ReviewRecord.from_dict(r))
            if valid:
                mem._store[agent_id] = _normalize_from_persistence(valid, max_history)
        return mem
