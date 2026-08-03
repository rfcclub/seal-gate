import { SealExtension, SealInput, SealIssue, makeIssue } from '../types.js'

export interface ExtensionResult {
  issues: SealIssue[]
  errors: string[]
}

export class ExtensionRegistry {
  private extensions: SealExtension[] = []

  add(ext: SealExtension): void {
    this.extensions.push(ext)
  }

  run(input: SealInput): ExtensionResult {
    const issues: SealIssue[] = []
    const errors: string[] = []

    for (const ext of this.extensions) {
      try {
        const result = ext.check(input)
        issues.push(...result)
      } catch (err) {
        const msg = `Extension [${ext.name}] failed: ${err instanceof Error ? err.message : String(err)}`
        errors.push(msg)
        issues.push(makeIssue({
          type: 'OTHER', severity: 'LOW', layer: 'EXTENSION', source: 'extension',
          evidence: msg,
        }))
      }
    }

    return { issues, errors }
  }
}
