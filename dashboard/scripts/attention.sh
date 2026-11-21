#!/bin/sh
# Run by the plugin's hooks: "set" on a notification, "clear" after a tool call, at the end of a turn and on a new prompt.
# Clearing runs after every tool call in every session, so it stops here unless this session left a marker.
input=$(cat)
# The first of each key is the hook's own; a tool's input or response can hold the same keys further on.
id=$(printf '%s' "$input" | grep -o '"session_id" *: *"[A-Za-z0-9_-]*"' | head -n 1 | sed 's/.*"\([A-Za-z0-9_-]*\)"$/\1/')
[ -n "$id" ] || exit 0
marker="$HOME/.cache/prg/waiting/$id"
if [ "$1" = clear ]; then
  [ -e "$marker" ] || exit 0
  tool=$(printf '%s' "$input" | grep -o '"tool_name" *: *"[^"]*"' | head -n 1 | sed 's/.*: *"\([^"]*\)"$/\1/')
  # The marker holds a tool name per line. A tool call clears only a tool that asked; the end of a turn or a new prompt clears whatever it was.
  if [ -n "$tool" ] && grep -q . "$marker" && ! grep -qxF "$tool" "$marker"; then
    exit 0
  fi
fi
command -v bun >/dev/null 2>&1 || exit 0
printf '%s' "$input" | bun "$(dirname "$0")/attention.mjs" "$1" >/dev/null 2>&1
exit 0
