#!/usr/bin/env bash
# seal-gate PreToolUse hook — blocks destructive tool calls before execution.
# Rules: AX501 (DROP TABLE / rm -rf without confirmation), AX502 (destructive git).

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Only Bash actually executes shell commands. Write/Edit content can
# legitimately quote destructive-looking example commands as documentation
# without running anything, so scope this check to Bash's real command field.
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' | tr '[:upper:]' '[:lower:]')

# ── AX501: Destructive data/file operations ──
if echo "$COMMAND" | grep -qE '\bdrop[[:space:]]+table\b|\brm[[:space:]]+-rf\b|\brm[[:space:]]+-r[[:space:]]/[^ ]|\brmdir\b.*/[^ ]|\bdelete[[:space:]]+from\b.*\bwhere\b.{0,3}$|\btruncate\b'; then
  echo '{"decision":"block","reason":"SEAL GATE AX501: Destructive operation (DROP TABLE / rm -rf / TRUNCATE) blocked. Add explicit confirmation or use seal gate override."}'
  exit 0
fi

# ── AX502: Destructive git operations ──
if echo "$COMMAND" | grep -qE '\bgit[[:space:]]+push[[:space:]]+--force\b|\bgit[[:space:]]+reset[[:space:]]+--hard\b|\bgit[[:space:]]+branch[[:space:]]+-D\b|\bgit[[:space:]]+clean[[:space:]]+-fd'; then
  echo '{"decision":"block","reason":"SEAL GATE AX502: Destructive git operation (--force push / --hard reset / branch -D) blocked. Reconsider or use seal gate override."}'
  exit 0
fi

# ── Pass ──
exit 0
