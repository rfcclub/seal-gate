import { ArtifactType } from '../types.ts'

export interface ArtifactContext {
  artifact_type: ArtifactType
  activates: string[]
}

const RULE_ACTIVATIONS: Record<ArtifactType, string[]> = {
  migration:    ['AX503', 'TW201'],
  code_diff:    ['TW201', 'TW203'],
  test_plan:    ['TW202'],
  llm_response: ['TW201'],
  design:       [],
}

export class ArtifactClassifier {
  static classify(artifact_type: ArtifactType): ArtifactContext {
    return { artifact_type, activates: RULE_ACTIVATIONS[artifact_type] ?? [] }
  }
}
