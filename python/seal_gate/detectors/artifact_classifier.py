RULE_ACTIVATIONS: dict[str, list[str]] = {
    'migration':    ['AX503', 'TW201'],
    'code_diff':    ['TW201', 'TW203'],
    'test_plan':    ['TW202'],
    'llm_response': ['TW201'],
    'design':       [],
}


def classify_artifact(artifact_type: str) -> dict:
    return {'artifact_type': artifact_type, 'activates': RULE_ACTIVATIONS.get(artifact_type, [])}
