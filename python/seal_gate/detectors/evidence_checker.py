from ..types import SealIssue, make_issue


def check_evidence(references: list, mode: str = 'portable') -> list[SealIssue]:
    """Validate evidence envelope structure. In portable mode (default), structural only."""
    issues: list[SealIssue] = []

    for ref in references:
        ref_type = ref.get('type', '')

        if ref_type == 'file':
            if not ref.get('path') or not ref.get('snapshot') or ref.get('line') is None:
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='MEDIUM', layer='L3', source='core',
                                         evidence='Malformed file envelope: path, line, and snapshot are required (non-empty)'))
            elif mode == 'filesystem':
                import os
                if not os.path.exists(ref['path']):
                    issues.append(make_issue(type='MISSING_EVIDENCE', severity='HIGH', layer='L3', source='core',
                                             evidence=f'File not found: {ref["path"]}', required_fix='Fix evidence path'))

        elif ref_type == 'command':
            if not ref.get('command') or not ref.get('output') or ref.get('exit_code') is None:
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='MEDIUM', layer='L3', source='core',
                                         evidence='Malformed command envelope: command, exit_code, and output are required (non-empty)'))

        elif ref_type == 'url':
            if not ref.get('url') or not ref.get('retrieved_at') or not ref.get('content_snapshot'):
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='MEDIUM', layer='L3', source='core',
                                         evidence='Malformed url envelope: url, retrieved_at, and content_snapshot are required (non-empty)'))

        elif ref_type == 'text':
            if not ref.get('label') or not ref.get('content'):
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='MEDIUM', layer='L3', source='core',
                                         evidence='Malformed text envelope: label and content are required (non-empty)'))

        elif ref_type == 'memory':
            if not ref.get('memory_key') or not ref.get('retrieved_at') or not ref.get('content_snapshot'):
                issues.append(make_issue(type='MISSING_EVIDENCE', severity='MEDIUM', layer='L3', source='core',
                                         evidence='Malformed memory envelope: memory_key, retrieved_at, and content_snapshot are required (non-empty)'))

        else:
            issues.append(make_issue(type='MISSING_EVIDENCE', severity='MEDIUM', layer='L3', source='core',
                                     evidence=f'Unknown evidence envelope type: {ref_type!r}'))

    return issues
