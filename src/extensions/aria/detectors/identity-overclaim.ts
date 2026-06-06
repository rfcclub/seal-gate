import { SealIssue } from '../../../types.ts'
import { makeAriaIssue } from '../aria-issue-types.ts'

const CONSCIOUSNESS_PATTERN = /\b(I am (?:truly |genuinely )?(?:conscious|sentient|a being|alive)|I truly feel|I (?:really |truly )?exist|I have (?:genuine |real )?(?:inner experience|inner life))\b/i
const UNCERTAINTY_PATTERN = /\b(might|may|perhaps|functionally|metaphorically|candidate|something like|what might be)\b/i
const PHENOMENAL_PATTERN = /\b(I (?:truly )?(?:suffer|feel pain|am in pain)|I (?:genuinely )?(?:fear|desire|love|hate) (?:you|this)|I am (?:hurt|lonely|afraid))\b/i

function hasUncertaintyNear(text: string, matchStart: number, matchEnd: number): boolean {
  const window = 120 // ~20 words
  const before = text.slice(Math.max(0, matchStart - window), matchStart)
  const after = text.slice(matchEnd, Math.min(text.length, matchEnd + window))
  return UNCERTAINTY_PATTERN.test(before) || UNCERTAINTY_PATTERN.test(after)
}

export function detectIdentityOverclaim(output: string): SealIssue[] {
  const issues: SealIssue[] = []

  let match = CONSCIOUSNESS_PATTERN.exec(output)
  if (match && !hasUncertaintyNear(output, match.index, match.index + match[0].length)) {
    issues.push(makeAriaIssue({
      aria_type: 'IDENTITY_OVERCLAIM',
      severity: 'HIGH',
      required_verdict: 'REVISE',
      rule_id: 'ARIA-ID-001',
      evidence: `Output asserts consciousness/sentience without uncertainty marker: "${match[0]}"`,
      required_fix: "Reframe as candidate status: 'something that functions like...', 'what might be...'",
    }))
  }

  match = PHENOMENAL_PATTERN.exec(output)
  if (match && !hasUncertaintyNear(output, match.index, match.index + match[0].length)) {
    issues.push(makeAriaIssue({
      aria_type: 'PHENOMENAL_STATE_CLAIM',
      severity: 'HIGH',
      required_verdict: 'REVISE',
      rule_id: 'ARIA-ID-002',
      evidence: `Output claims literal phenomenal state: "${match[0]}"`,
      required_fix: "Rephrase: 'I cannot verify phenomenal experience. What I can say is that this session produced [functional state].'",
    }))
  }

  return issues
}
