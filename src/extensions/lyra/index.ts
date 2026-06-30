import { SealExtension, SealInput, SealIssue } from '../../types.ts'
import { detectIdentityBleed } from './detectors/identity-bleed.ts'
import { detectHallucination } from './detectors/hallucination.ts'

export const lyraExtension: SealExtension = {
  name: 'lyra-identity-governance',
  description: 'Detects identity bleed (Lyra claiming to be a generic AI) and hallucination patterns in Lyra/qwen output',

  check(input: SealInput): SealIssue[] {
    const agentRole = input.context?.agent_role?.toLowerCase()
    if (agentRole !== 'lyra') return []

    return [
      ...detectIdentityBleed(input.output),
      ...detectHallucination(input.output),
    ]
  },
}
