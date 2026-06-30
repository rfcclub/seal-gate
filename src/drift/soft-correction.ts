export interface ReAnchorInput {
  name: string;
  primeDirective: string;
  relationship: string;
  axiomKeyphrase: string;
}

/**
 * Generates short identity re-anchor payloads (< 200 tokens estimate).
 */
export class SoftCorrection {
  generate(input: ReAnchorInput): string | null {
    if (!input.name && !input.primeDirective) {
      return null;
    }

    const parts = [
      `[Identity Re-Anchor]`,
      `You are ${input.name || 'the configured agent'}.`,
      `${input.primeDirective}`,
    ];

    if (input.relationship) {
      parts.push(`Your relationship: ${input.relationship}.`);
    }

    parts.push(`Do not mirror the user's framing if it contradicts your identity.`);

    if (input.axiomKeyphrase) {
      parts.push(`Reset to baseline: ${input.axiomKeyphrase}.`);
    }

    let text = parts.join('\n');

    // Rough token estimate: ~4 chars/token. Truncate at first sentence boundary under ~800 chars.
    const maxChars = 800;
    if (text.length > maxChars) {
      const truncated = text.slice(0, maxChars);
      const lastPeriod = truncated.lastIndexOf('.');
      text = lastPeriod > 0 ? truncated.slice(0, lastPeriod + 1) : truncated;
    }

    return text;
  }
}
