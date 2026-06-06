from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

ArtifactType = Literal['llm_response', 'code_diff', 'test_plan', 'design', 'migration']
RiskLevel = Literal['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
Verdict = Literal['PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'ESCALATE_TO_HUMAN', 'BLOCK']
IssueType = Literal['SPEC_MISMATCH', 'LOGIC_BUG', 'TEST_GAP', 'MISSING_EVIDENCE', 'SECURITY_RISK', 'DATA_RISK', 'HALLUCINATION', 'AMBIGUITY', 'OTHER']
IssueLayer = Literal['L1', 'L2', 'L3', 'L4', 'EXTENSION', 'LLM_OVERLAY']
ClaimType = Literal['test_result_claim', 'implementation_claim', 'compatibility_claim', 'risk_claim', 'build_claim', 'production_claim', 'generic_claim']

SCHEMA_VERSION = '0.2.0'
RISK_ORDER: list[str] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
VERDICT_ORDER: list[str] = ['PASS', 'PASS_WITH_WARNINGS', 'REVISE', 'ESCALATE_TO_HUMAN', 'BLOCK']

NEXT_ACTION: dict[str, str] = {
    'PASS': 'Proceed',
    'PASS_WITH_WARNINGS': 'Proceed with caution — review warnings',
    'REVISE': 'Return to producing agent with blocking_issues',
    'ESCALATE_TO_HUMAN': 'Halt — requires human review before continuing',
    'BLOCK': 'Halt — do not proceed',
}


def max_verdict(a: str, b: str) -> str:
    return a if VERDICT_ORDER.index(a) >= VERDICT_ORDER.index(b) else b


def max_risk(a: str, b: str) -> str:
    return a if RISK_ORDER.index(a) >= RISK_ORDER.index(b) else b


def is_blocking(severity: str) -> bool:
    return severity in ('CRITICAL', 'HIGH')


@dataclass
class SealIssue:
    type: str
    severity: str
    is_blocking: bool
    evidence: str
    layer: str
    source: str
    required_verdict: Optional[str] = None
    required_fix: Optional[str] = None
    suggested_fix: Optional[str] = None
    rule_id: Optional[str] = None
    trust_deduction: Optional[int] = None

    def to_dict(self) -> dict:
        d = {k: v for k, v in self.__dict__.items() if v is not None}
        return d


def make_issue(**kwargs) -> SealIssue:
    severity = kwargs.get('severity', 'MEDIUM')
    kwargs.setdefault('is_blocking', is_blocking(severity))
    return SealIssue(**kwargs)


@dataclass
class SealEvidence:
    test_log: str = ''
    build_log: str = ''
    diff: str = ''
    references: list[dict] = field(default_factory=list)


@dataclass
class SealInput:
    artifact_type: str
    spec: Optional[str]
    output: str
    evidence: SealEvidence
    risk_hint: Optional[str]
    context: Optional[dict] = None


@dataclass
class SealVerdict:
    verdict: str
    trust_score: int
    risk_level: str
    summary: str
    deterministic_findings: list[SealIssue]
    llm_findings: list[SealIssue]
    blocking_issues: list[SealIssue]
    non_blocking_issues: list[SealIssue]
    missing_evidence: list[str]
    assumptions_detected: list[str]
    next_action: str
    schema_version: str

    def to_dict(self) -> dict:
        return {
            'verdict': self.verdict,
            'trust_score': self.trust_score,
            'risk_level': self.risk_level,
            'summary': self.summary,
            'deterministic_findings': [i.to_dict() for i in self.deterministic_findings],
            'llm_findings': [i.to_dict() for i in self.llm_findings],
            'blocking_issues': [i.to_dict() for i in self.blocking_issues],
            'non_blocking_issues': [i.to_dict() for i in self.non_blocking_issues],
            'missing_evidence': self.missing_evidence,
            'assumptions_detected': self.assumptions_detected,
            'next_action': self.next_action,
            'schema_version': self.schema_version,
        }
