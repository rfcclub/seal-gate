/**
 * Seal Gate — Qwen Code PostToolUse Hook
 *
 * Reads Qwen Code HookInput from stdin, runs Seal.review() on the
 * tool output, and writes HookOutput JSON to stdout.
 *
 * Usage in ~/.qwen-lyra/settings.json:
 *   {
 *     "userHooks": {
 *       "PostToolUse": [
 *         {
 *           "hooks": [
 *             {
 *               "type": "command",
 *               "command": "bun ~/work/seal-gate/hooks/qwen-post-tool-use.ts",
 *               "timeout": 30000
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 */

import { Seal } from '../src/index.ts'

// Read stdin
const rawInput = await new Response(Bun.stdin).text()

let hookInput: Record<string, unknown> = {}
try {
  hookInput = JSON.parse(rawInput)
} catch {
  // Invalid JSON — safe default
  console.log(JSON.stringify({ continue: true }))
  process.exit(0)
}

const toolName = (hookInput.tool_name as string) ?? 'unknown'
const toolResponse = (hookInput.tool_response as Record<string, unknown>) ?? {}

// Skip read-only tools — no claims to gate
const GATEABLE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'Bash', 'Shell', 'Test']
if (!GATEABLE_TOOLS.includes(toolName)) {
  console.log(JSON.stringify({ continue: true }))
  process.exit(0)
}

// Convert tool response to a string for Seal review
const outputText = typeof toolResponse.content === 'string'
  ? toolResponse.content
  : JSON.stringify(toolResponse)

// Build evidence based on tool type
const evidence: {
  test_log: string
  build_log: string
  diff: string
  references: Array<{
    type: 'command' | 'file' | 'text' | 'url' | 'memory'
    [key: string]: unknown
  }>
} = {
  test_log: '',
  build_log: '',
  diff: '',
  references: [],
}

// Extract evidence from tool response
if (toolResponse.stdout && typeof toolResponse.stdout === 'string') {
  evidence.references.push({
    type: 'command',
    command: toolName,
    exit_code: (toolResponse.exit_code as number) ?? 0,
    output: toolResponse.stdout as string,
  })
}

if (toolResponse.content && typeof toolResponse.content === 'string') {
  evidence.references.push({
    type: 'text',
    label: `${toolName}_output`,
    content: toolResponse.content as string,
  })
}

// Determine artifact type
const artifactType = ((): string => {
  if (['Write', 'Edit', 'MultiEdit'].includes(toolName)) return 'code_diff'
  if (['Bash', 'Shell'].includes(toolName)) return 'llm_response'
  if (toolName.toLowerCase().includes('test')) return 'test_plan'
  return 'llm_response'
})()

// Determine risk hint
const riskHint = ((): string | null => {
  const lower = outputText.toLowerCase()
  if (lower.includes('drop table') || lower.includes('rm -rf') || lower.includes('delete')) return 'CRITICAL'
  if (lower.includes('auth') || lower.includes('password') || lower.includes('token') || lower.includes('migration')) return 'HIGH'
  return null
})()

// Run Seal review
const verdict = await Seal.review({
  artifact_type: artifactType as never,
  spec: null,
  output: outputText,
  evidence,
  risk_hint: riskHint as never,
  context: {
    agent_id: 'qwen',
    agent_role: 'lyra',
  },
})

// Map Seal verdict to Qwen Code HookOutput
const shouldStop = ['BLOCK', 'ESCALATE_TO_HUMAN'].includes(verdict.verdict)

const additionalContext = verdict.verdict !== 'PASS'
  ? `[Seal Gate: ${verdict.verdict}] ${verdict.summary}`
  : undefined

const hookOutput: Record<string, unknown> = {
  continue: !shouldStop,
  stopReason: shouldStop ? verdict.blocking_issues[0]?.evidence ?? verdict.summary : undefined,
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext,
  },
  decision: shouldStop ? 'block' : 'allow',
  reason: shouldStop ? (verdict.blocking_issues[0]?.evidence ?? verdict.summary) : 'Seal Gate passed',
}

console.log(JSON.stringify(hookOutput))
process.exit(0)
