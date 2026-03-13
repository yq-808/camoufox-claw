#!/usr/bin/env bash
set -euo pipefail

TARGET_FILE="${1:-AGENTS.md}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNIPPET_FILE="${SNIPPET_FILE:-$SCRIPT_DIR/../snippets/AGENTS-redlines.md}"

if [[ ! -f "$TARGET_FILE" ]]; then
  echo "Target file not found: $TARGET_FILE" >&2
  exit 1
fi

if [[ ! -f "$SNIPPET_FILE" ]]; then
  echo "Snippet file not found: $SNIPPET_FILE" >&2
  exit 1
fi

if grep -q '^### OpenClaw Runtime Safety$' "$TARGET_FILE"; then
  echo "Redline block already present."
  exit 0
fi

TMP_OUT="$(mktemp)"
if grep -q '^## Red Lines$' "$TARGET_FILE"; then
  awk -v sf="$SNIPPET_FILE" '
    {
      print
      if ($0=="## Red Lines") {
        print ""
        while ((getline line < sf) > 0) print line
        close(sf)
        print ""
      }
    }
  ' "$TARGET_FILE" > "$TMP_OUT"
else
  cat "$TARGET_FILE" > "$TMP_OUT"
  printf "\n" >> "$TMP_OUT"
  cat "$SNIPPET_FILE" >> "$TMP_OUT"
  printf "\n" >> "$TMP_OUT"
fi

mv "$TMP_OUT" "$TARGET_FILE"
echo "Applied redline block from $SNIPPET_FILE to $TARGET_FILE"
