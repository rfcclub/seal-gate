import { SealInput, ArtifactType, RiskLevel } from '../types.ts'
import { SealInputError } from '../errors.ts'

const VALID_ARTIFACT_TYPES: ArtifactType[] = ['llm_response', 'code_diff', 'test_plan', 'design', 'migration', 'plan_review']
const VALID_RISK_LEVELS: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export class InputNormalizer {
  static normalize(input: Partial<SealInput>): SealInput {
    if (!input.output || input.output.trim() === '') {
      throw new SealInputError('output is required and must be non-empty', 'output')
    }
    if (!input.artifact_type || !VALID_ARTIFACT_TYPES.includes(input.artifact_type)) {
      throw new SealInputError(`artifact_type must be one of: ${VALID_ARTIFACT_TYPES.join(', ')}`, 'artifact_type')
    }
    if (input.risk_hint !== null && input.risk_hint !== undefined && !VALID_RISK_LEVELS.includes(input.risk_hint)) {
      throw new SealInputError(`risk_hint must be one of: ${VALID_RISK_LEVELS.join(', ')} or null`, 'risk_hint')
    }
    return {
      artifact_type: input.artifact_type,
      spec: input.spec ?? null,
      output: input.output.trim(),
      evidence: {
        test_log: input.evidence?.test_log ?? '',
        build_log: input.evidence?.build_log ?? '',
        diff: input.evidence?.diff ?? '',
        references: input.evidence?.references ?? [],
      },
      risk_hint: input.risk_hint ?? null,
      context: input.context,
    }
  }
}
