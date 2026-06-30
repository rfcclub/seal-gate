import { EvidenceEnvelope, EvidenceResult } from '../types.ts'
import { existsSync, readFileSync } from 'node:fs'

export type EvidenceMode = 'portable' | 'filesystem'

export class EvidenceChecker {
  static check(references: EvidenceEnvelope[], options: { mode: EvidenceMode } = { mode: 'portable' }): EvidenceResult[] {
    return references.map(envelope => this.checkOne(envelope, options.mode))
  }

  private static checkOne(envelope: EvidenceEnvelope, mode: EvidenceMode): EvidenceResult {
    // Structural validation
    if (envelope.type === 'file') {
      if (!envelope.path || envelope.line === undefined || !envelope.snapshot) {
        return { envelope, structurally_valid: false, filesystem_verified: null, mismatch_detail: 'Missing path, line, or snapshot' }
      }
      if (mode === 'filesystem') {
        if (!existsSync(envelope.path)) {
          return { envelope, structurally_valid: true, filesystem_verified: false, mismatch_detail: `File not found: ${envelope.path}` }
        }
        const lines = readFileSync(envelope.path, 'utf-8').split('\n')
        const actualLine = lines[envelope.line - 1] ?? ''
        if (actualLine.trim() !== envelope.snapshot.trim()) {
          return { envelope, structurally_valid: true, filesystem_verified: false, mismatch_detail: `Snapshot mismatch at ${envelope.path}:${envelope.line}` }
        }
        return { envelope, structurally_valid: true, filesystem_verified: true }
      }
      return { envelope, structurally_valid: true, filesystem_verified: null }
    }

    if (envelope.type === 'command') {
      const hasRequiredFields = !!(envelope.command && envelope.output && envelope.exit_code !== undefined)
      if (!hasRequiredFields) return { envelope, structurally_valid: false, filesystem_verified: null, mismatch_detail: 'Missing command, exit_code, or output' }
      // A non-zero exit code means the command failed — treat as invalid evidence for bonus purposes
      const passed = envelope.exit_code === 0
      return { envelope, structurally_valid: true, filesystem_verified: passed, mismatch_detail: passed ? undefined : `Command failed with exit_code ${envelope.exit_code}` }
    }

    if (envelope.type === 'url') {
      const valid = !!(envelope.url && envelope.retrieved_at && envelope.content_snapshot)
      return { envelope, structurally_valid: valid, filesystem_verified: null, mismatch_detail: valid ? undefined : 'Missing url, retrieved_at, or content_snapshot' }
    }

    if (envelope.type === 'text') {
      const valid = !!(envelope.label && envelope.content)
      return { envelope, structurally_valid: valid, filesystem_verified: null }
    }

    if (envelope.type === 'memory') {
      const valid = !!(envelope.memory_key && envelope.retrieved_at && envelope.content_snapshot)
      return { envelope, structurally_valid: valid, filesystem_verified: null }
    }

    return { envelope, structurally_valid: false, filesystem_verified: null, mismatch_detail: 'Unknown envelope type' }
  }
}
