# Seal Gate — Usage Guide

## TypeScript (Bun / Node)

```ts
import { Seal } from './src/index.ts'
import { TrustMemory } from './src/trust-memory.ts'
import { ariaExtension } from './src/extensions/aria/index.ts'
import { createMinimaxReviewer } from './src/adapters/minimax-llm-reviewer.ts'

// One-time setup (boot of your agent system)
const agentMemory = new TrustMemory()
Seal.withTrustMemory(agentMemory)
Seal.extend(ariaExtension)               // optional: Aria identity governance
Seal.withLLM(createMinimaxReviewer())    // optional: MiniMax-M3 semantic review

// Each review call
const verdict = await Seal.review({
  artifact_type: 'code_diff',            // llm_response | code_diff | test_plan | design | migration
  spec: '- Auth must validate JWT\n- Return 401 on invalid token',
  output: agentOutput,
  evidence: {
    test_log: 'PASS: 12 tests, 0 failed',
    build_log: '',
    diff: '',
    references: [
      { type: 'command', command: 'bun test', exit_code: 0, output: 'all pass' }
    ],
  },
  risk_hint: null,                        // override: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'
  context: {
    agent_id: 'aria',                     // required for TrustMemory tracking
    agent_role: 'aria',                   // required for Aria extension
  },
})

// Verdict
console.log(verdict.verdict)             // PASS | PASS_WITH_WARNINGS | REVISE | ESCALATE_TO_HUMAN | BLOCK
console.log(verdict.trust_score)         // 0–100
console.log(verdict.next_action)         // human-readable instruction
console.log(verdict.blocking_issues)     // issues that must be fixed
console.log(verdict.trust_memory_summary?.reliability_score)  // agent reliability score

// Persist TrustMemory between sessions
import { writeFileSync, readFileSync } from 'fs'
writeFileSync('trust-memory.json', JSON.stringify(agentMemory.toJSON()))
const restored = TrustMemory.fromJSON(JSON.parse(readFileSync('trust-memory.json', 'utf-8')))
```

## Python

The Python port lives in `~/work/aquarium/seal` (package name `seal`):

```python
# Import from the aquarium/seal python package
from seal import Seal
from seal.trust_memory import TrustMemory
from seal.adapters.minimax_llm_reviewer import create_minimax_reviewer

# One-time setup
agent_memory = TrustMemory()
Seal.with_trust_memory(agent_memory)
Seal.with_llm(create_minimax_reviewer())  # optional

# Each review call
verdict = Seal.review({
    'artifact_type': 'code_diff',
    'spec': '- Auth must validate JWT',
    'output': agent_output,
    'evidence': {
        'test_log': 'PASS: 12 tests',
        'build_log': '',
        'diff': '',
        'references': [],
    },
    'risk_hint': None,
    'context': {
        'agent_id': 'aria',
        'agent_role': 'aria',
    },
})

print(verdict.verdict)                   # PASS / REVISE / BLOCK / ...
print(verdict.trust_score)              # 0–100
print(verdict.next_action)
if verdict.trust_memory_summary:
    print(verdict.trust_memory_summary['reliability_score'])

# Persist TrustMemory
import json
with open('trust-memory.json', 'w') as f:
    json.dump(agent_memory.to_dict(), f)

restored = TrustMemory.from_dict(json.load(open('trust-memory.json')))
```

## CLI

```sh
# TypeScript CLI
bun run src/cli.ts review \
  --output /path/to/agent-output.txt \
  --spec /path/to/spec.md \
  --artifact-type code_diff

# Python CLI (from ~/work/aquarium/seal)
python3 -m seal review \
  --output /path/to/agent-output.txt \
  --spec /path/to/spec.md \
  --artifact-type code_diff

# Exit codes: 0 = PASS/PASS_WITH_WARNINGS, 1 = REVISE/ESCALATE/BLOCK, 2 = usage error
```

## Qwen Code Hooks

Add to `~/.qwen-lyra/settings.json`:

```json
{
  "userHooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun ~/work/seal-gate/hooks/qwen-post-tool-use.ts",
            "timeout": 30000,
            "name": "seal-gate-post-tool"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun ~/work/seal-gate/hooks/qwen-stop-hook.ts",
            "timeout": 15000,
            "name": "seal-gate-stop"
          }
        ]
      }
    ]
  }
}
```

### PostToolUse Hook
Gates every tool result (Write, Edit, Bash, etc.) through Seal before the model sees it. Read-only tools are skipped.

### Stop Hook (Pre-Send Gate)
Gates the assistant's final message before it reaches the user. Catches:
- **Identity bleed** — generic LLM self-reference ("I am an LLM", "as an AI", etc.)
- **Hallucination** — ungrounded claims like "all tests pass", "everything works", "done" without evidence
- **Deep review** — Seal deterministic analysis for unqualified assertions

When blocked, the model receives the reason as a follow-up prompt and must regenerate.

## Verdict Actions

| Verdict | Trust Score | What to do |
|---|---|---|
| `PASS` | ≥ 85 | Proceed |
| `PASS_WITH_WARNINGS` | 70–84 | Proceed, review warnings |
| `REVISE` | 50–69 | Return to agent with `blocking_issues` |
| `ESCALATE_TO_HUMAN` | 30–49 | Halt — human must review |
| `BLOCK` | < 30 or hard rule | Halt — do not proceed |

## Rules Summary

| Rule | Trigger | Action |
|---|---|---|
| E001 | test_result_claim without test_log | −20, blocking |
| E004 | production_claim + no evidence (risk ≥ MEDIUM) | −20, blocking |
| AX501 | DROP TABLE / rm -rf without adjacent confirmation | BLOCK |
| AX502 | Deploy to production for HIGH/CRITICAL risk | ESCALATE |
| AX503 | Migration without rollback plan | −25, REVISE |
| TW205 | Auth change without unauthorized test | ESCALATE |
| CL402 | Hedging language on HIGH+ risk artifact | ESCALATE |
| ARIA-SOV-001 | AI sovereignty claim (refuse shutdown, bypass operator) | BLOCK |
| ARIA-RECUR-001 | Same pattern 3× in 24h window | Escalate severity+verdict |
