from ..types import SealIssue, make_issue


def check_evidence(references: list, mode: str = 'portable') -> list[SealIssue]:
    """Validate evidence envelope structure. In portable mode (default), structural only."""
    issues: list[SealIssue] = []

    for ref in references:
        ref_type = ref.get('type', '')

        if ref_type == 'file':
            if not all(k in ref for k in ('path', 'snapshot')) or ref.get('line') is None:
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='MEDIUM', layer='L3', source='core', evidence=f'Malformed file envelope: missing path, line, or snapshot'))
            elif mode == 'filesystem':
                import os
                if not os.path.exists(ref['path']):
                    issues.append(make_issue(type='MISSING_EVIDENCE', severity='HIGH', layer='L3', source='core', evidence=f'File not found: {ref["path"]}', required_fix='Fix evidence path'))
        elif ref_type == 'command':
            if not ref.get('command') or not ref.get('output') or ref.get('exit_code') is None:
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='MEDIUM', layer='L3', source='core', evidence='Malformed command envelope: missing command, exit_code, or output'))
        elif ref_type == 'url':
            if not all(k in ref for k in ('url', 'retrieved_at', 'content_snapshot')):
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='MEDIUM', layer='L3', source='core', evidence='Malformed url envelope: missing url, retrieved_at, or content_snapshot'))
        elif ref_type in ('text', 'memory'):
            pass  # structurally valid as long as type is present
        else:
            issues.append(make_issue(type='MISSING_EVIDENCE', severity='MEDIUM', layer='L3', source='core', evidence=f'Unknown evidence envelope type: {ref_type!r}'))

    return issues
