from ..types import SealInput, SealEvidence
from ..errors import SealInputError

VALID_ARTIFACT_TYPES = {'llm_response', 'code_diff', 'test_plan', 'design', 'migration'}
VALID_RISK_LEVELS = {'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'}


def normalize(raw: dict) -> SealInput:
    output = raw.get('output', '')
    if not output or not str(output).strip():
        raise SealInputError('output is required and must be non-empty', 'output')

    artifact_type = raw.get('artifact_type', '')
    if artifact_type not in VALID_ARTIFACT_TYPES:
        raise SealInputError(f'artifact_type must be one of: {", ".join(VALID_ARTIFACT_TYPES)}', 'artifact_type')

    risk_hint = raw.get('risk_hint')
    if risk_hint is not None and risk_hint not in VALID_RISK_LEVELS:
        raise SealInputError(f'risk_hint must be one of: {", ".join(VALID_RISK_LEVELS)} or null', 'risk_hint')

    evidence_raw = raw.get('evidence') or {}
    evidence = SealEvidence(
        test_log=evidence_raw.get('test_log', ''),
        build_log=evidence_raw.get('build_log', ''),
        diff=evidence_raw.get('diff', ''),
        references=evidence_raw.get('references', []),
    )

    return SealInput(
        artifact_type=artifact_type,
        spec=raw.get('spec'),
        output=str(output).strip(),
        evidence=evidence,
        risk_hint=risk_hint,
        context=raw.get('context'),
    )
