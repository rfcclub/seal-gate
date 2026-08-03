#!/usr/bin/env node
import { Seal } from './index.js'
import { ArtifactType, RiskLevel } from './types.js'
import { VERSION } from './version.js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

function colorForVerdict(v: string): string {
  if (v === 'PASS') return GREEN
  if (v === 'PASS_WITH_WARNINGS') return YELLOW
  return RED
}

function usage() {
  console.log(`
${BOLD}seal${RESET} v${VERSION} — AI quality gate

${BOLD}USAGE${RESET}
  seal <command> [options]

${BOLD}COMMANDS${RESET}
  ${CYAN}code${RESET}     <file>       Review code output / diff (default mode)
  ${CYAN}plan${RESET}     <file>       Review plan, design, or spec (plan_review mode)
  ${CYAN}review${RESET}   <file>       Review with full control over artifact type

${BOLD}OPTIONS${RESET}
  --llm [provider]             Enable LLM reviewer (auto | minimax | fireworks | gemini | xiaomi | local)
  --spec <file>                Spec file for compliance check
  --locked-criteria <file>     JSON file with locked acceptance criteria (plan_review)
  --risk <level>               Risk hint: low, medium, high, critical
  --agent-id <id>              Agent identifier for trust memory
  --json                       Raw JSON output (no formatting)
  --artifact-type <type>       Override: llm_response, code_diff, test_plan, design, migration, plan_review

${BOLD}EXAMPLES${RESET}
  ${DIM}# Review with LLM reviewer${RESET}
  seal code src/auth.ts --llm minimax

  ${DIM}# Review a code change${RESET}
  seal code src/auth.ts --spec specs/auth.md

  ${DIM}# Review a plan/spec against locked criteria${RESET}
  seal plan spec.md --locked-criteria intent-criteria.json

  ${DIM}# Full control mode${RESET}
  seal review output.md --artifact-type plan_review --locked-criteria criteria.json
`)
  process.exit(2)
}

export function parseArgs(args: string[]) {
  const parsed: Record<string, string | boolean> = {}
  let positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      if (key === 'json' || key === 'version') { parsed[key] = true; continue }
      // --llm takes an optional value (provider name, or 'auto') — but must not swallow
      // the NEXT flag as its value when no provider was actually given (bare --llm).
      if (key === 'llm') {
        const next = args[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          parsed[key] = next
          i++
        } else {
          parsed[key] = true
        }
        continue
      }
      parsed[key] = args[++i] ?? ''
    } else {
      positional.push(args[i])
    }
  }
  return { positional, parsed }
}

function formatVerdict(v: any, json: boolean) {
  if (json) {
    console.log(JSON.stringify(v, null, 2))
    return
  }

  const c = colorForVerdict(v.verdict)
  const scoreBar = v.trust_score >= 90 ? '██████████' :
                   v.trust_score >= 70 ? '███████░░░' :
                   v.trust_score >= 50 ? '█████░░░░░' :
                   v.trust_score >= 30 ? '███░░░░░░░' : '█░░░░░░░░░'

  console.log(`\n${BOLD}┌─ Seal v${v.version} Verdict ──────────────────────┐${RESET}`)
  console.log(`${BOLD}│${RESET}  ${c}${BOLD}${v.verdict}${RESET}  ${DIM}(trust: ${v.trust_score})${RESET}  ${scoreBar}`)
  console.log(`${BOLD}│${RESET}  Risk: ${v.risk_level}`)
  console.log(`${BOLD}│${RESET}  ${v.summary}`)

  if (v.blocking_issues?.length > 0) {
    console.log(`${BOLD}│${RESET}`)
    console.log(`${BOLD}│${RESET}  ${RED}${BOLD}Blocking Issues:${RESET}`)
    for (const issue of v.blocking_issues) {
      console.log(`${BOLD}│${RESET}    ${RED}✗${RESET} [${issue.rule_id}] ${issue.evidence}`)
    }
  }

  if (v.non_blocking_issues?.length > 0) {
    console.log(`${BOLD}│${RESET}`)
    console.log(`${BOLD}│${RESET}  ${YELLOW}Non-blocking:${RESET}`)
    for (const issue of v.non_blocking_issues) {
      console.log(`${BOLD}│${RESET}    ${YELLOW}⚠${RESET} [${issue.rule_id}] ${issue.evidence}`)
    }
  }

  if (v.deterministic_findings?.length === 0 && v.blocking_issues?.length === 0) {
    console.log(`${BOLD}│${RESET}`)
    console.log(`${BOLD}│${RESET}  ${GREEN}✓${RESET} No issues found`)
  }

  console.log(`${BOLD}│${RESET}  ${DIM}Next: ${v.next_action}${RESET}`)
  console.log(`${BOLD}└────────────────────────────────────────────┘${RESET}`)
}

async function run(args: string[]) {
  const { positional, parsed } = parseArgs(args)
  const cmd = positional[0]

  if (parsed['version'] || cmd === 'version' || cmd === '-v') { console.log(`seal v${VERSION}`); process.exit(0) }
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') usage()

  // Wire LLM reviewer if --llm flag is present
  let llmFlagUsed = false
  if (parsed['llm']) {
    llmFlagUsed = true
    const { createReviewer } = await import('./adapters/generic-llm-reviewer.js')
    const llmValue = parsed['llm']
    if (llmValue === 'auto') {
      // --llm auto (AD-5): heuristic-scorer runs first; LLM reviewer only called when
      // the heuristic result is ambiguous. Provider auto-detects from env vars, same as bare --llm.
      Seal.withLLM(createReviewer({}), { mode: 'auto' })
    } else {
      const provider = llmValue === true ? undefined : (llmValue as string)
      Seal.withLLM(createReviewer({ provider: provider as any }))
    }
  }

  let artifactFile: string | null = null
  let artifactType: ArtifactType = 'llm_response'
  let specFile: string | null = null
  let lockedCriteriaFile: string | null = null
  let riskHint: RiskLevel | null = null
  let agentId: string | null = null
  let jsonOutput = !!parsed['json']

  switch (cmd) {
    case 'code':
      artifactFile = positional[1]
      artifactType = 'code_diff'
      break
    case 'plan':
    case 'spec':
    case 'design':
      artifactFile = positional[1]
      artifactType = 'plan_review'
      break
    case 'review':
      artifactFile = positional[1]
      artifactType = (parsed['artifact-type'] as ArtifactType) ?? 'llm_response'
      break
    default:
      // `seal <file>` shorthand — treat first arg as file
      if (existsSync(cmd)) {
        artifactFile = cmd
        artifactType = 'llm_response'
      } else {
        console.error(`Unknown command or file not found: ${cmd}`)
        usage()
      }
  }

  if (!artifactFile) { console.error('Error: no file specified'); usage() }

  const filePath = artifactFile as string
  if (!existsSync(filePath)) {
    console.error(`Error: file not found: ${filePath}`)
    process.exit(2)
  }

  // Resolve optional flags
  if (parsed['spec']) { specFile = parsed['spec'] as string }
  if (parsed['locked-criteria']) { lockedCriteriaFile = parsed['locked-criteria'] as string }
  if (parsed['risk']) { riskHint = parsed['risk'] as RiskLevel }
  if (parsed['agent-id']) { agentId = parsed['agent-id'] as string }
  // Load files
  const output = readFileSync(resolve(filePath), 'utf-8')
  const spec = specFile && existsSync(specFile) ? readFileSync(resolve(specFile), 'utf-8') : null
  const evidence = { test_log: '', build_log: '', diff: '', references: [] }

  const lockedCriteria = lockedCriteriaFile && existsSync(lockedCriteriaFile)
    ? JSON.parse(readFileSync(resolve(lockedCriteriaFile), 'utf-8'))
    : []

  const context: Record<string, unknown> = {}
  if (agentId) context.agent_id = agentId
  if (lockedCriteria.length > 0) context.locked_criteria = lockedCriteria

  if (!jsonOutput) {
    console.log(`${DIM}Seal reviewing ${artifactFile} (${artifactType})...${RESET}`)
  }

  const verdict = await Seal.review({
    artifact_type: artifactType,
    spec,
    output,
    evidence,
    risk_hint: riskHint,
    context: Object.keys(context).length > 0 ? context : undefined,
  })

  formatVerdict(verdict, jsonOutput)

  // Hint when --llm used but LLM reviewer failed (no API key)
  if (llmFlagUsed && verdict.assumptions_detected?.some(a => a.includes('L2') && (a.includes('not reviewed') || a.includes('error')))) {
    if (!jsonOutput) {
      console.log(`${DIM}💡 Tip: Set an API key env var (MINIMAX_PLAN_KEY, FIREWORKS_API_KEY, GEMINI_API_KEY, etc.) to enable LLM review.${RESET}`)
    }
  }

  const passing = verdict.verdict === 'PASS' || verdict.verdict === 'PASS_WITH_WARNINGS'
  process.exit(passing ? 0 : 1)
}

// Guarded so importing this module (e.g. from tests, to exercise parseArgs) doesn't
// also execute the CLI and call process.exit().
if (import.meta.main) {
  run(process.argv.slice(2)).catch(err => {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  })
}
