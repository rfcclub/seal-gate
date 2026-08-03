import re
from dataclasses import dataclass
from typing import Optional

CLAIM_PATTERNS = [
    ('test_result_claim',    re.compile(r'\b(all tests? pass(?:ed)?|tests? pass(?:ed)?|verified|tested)\b', re.I)),
    ('implementation_claim', re.compile(r'\b(implemented|fixed|completed|resolved|built|deployed)\b', re.I)),
    ('compatibility_claim',  re.compile(r'\b(backward.?compatible|no breaking changes|fully compatible)\b', re.I)),
    ('risk_claim',           re.compile(r'\b(no security impact|no risk of (?:breach|exploit|injection|attack)|safe to (?:deploy|release|merge)|security[- ](?:free|cleared)|no (?:auth|security) (?:change|impact|risk))\b', re.I)),
    ('build_claim',          re.compile(r'\b(build succeeded|compiled|build pass(?:ed)?|build is (?:clean|green))\b', re.I)),
    ('production_claim',     re.compile(r'\b(production.?ready|ready for (?:production|deploy|release))\b', re.I)),
    ('generic_claim',        re.compile(r'\b(definitely|guaranteed|fully|completely|all good|no issues)\b', re.I)),
]

BLOCK_FENCE = re.compile(r'```[\s\S]*?```')
INLINE_FENCE = re.compile(r'`[^`\n]+`')


@dataclass
class Claim:
    text: str
    type: str
    start_pos: int
    end_pos: int
    requires_evidence: bool = True


def get_fence_ranges(text: str) -> list[tuple[int, int]]:
    ranges = []
    for m in BLOCK_FENCE.finditer(text):
        ranges.append((m.start(), m.end()))
    for m in INLINE_FENCE.finditer(text):
        ranges.append((m.start(), m.end()))
    return ranges


def in_fence(pos: int, fence_ranges: list[tuple[int, int]]) -> bool:
    return any(s <= pos < e for s, e in fence_ranges)


def overlaps(start: int, end: int, used: set[tuple[int, int]]) -> bool:
    return any(s < end and e > start for s, e in used)


def extract_claims(text: str) -> list[Claim]:
    fence_ranges = get_fence_ranges(text)
    used: set[tuple[int, int]] = set()
    claims: list[Claim] = []

    for claim_type, pattern in CLAIM_PATTERNS:
        for m in pattern.finditer(text):
            start, end = m.start(), m.end()
            if in_fence(start, fence_ranges):
                continue
            if overlaps(start, end, used):
                continue
            used.add((start, end))
            claims.append(Claim(text=m.group(0), type=claim_type, start_pos=start, end_pos=end))

    return sorted(claims, key=lambda c: c.start_pos)


def get_used_spans(claims: list[Claim]) -> set[tuple[int, int]]:
    return {(c.start_pos, c.end_pos) for c in claims}
