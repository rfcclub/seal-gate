import { defineConfig } from 'vitest/config'

// Execute the same Bun-authored policy assertions through Orca's supported
// Vitest reporter; the native Bun suite remains the repository's primary suite.
export default defineConfig({
  resolve: { alias: { 'bun:test': 'vitest' } },
  test: { include: ['tests/property/**/*.test.ts', 'tests/spec/**/*.test.ts', 'tests/cli/**/*.test.ts', 'tests/gate/**/*.test.ts'] },
})
