#!/bin/sh
# Run by the plugin's hooks: "set" on a notification, "clear" after a tool call, at the end of a turn and on a new prompt.
# Clearing runs after every tool call in every session, so it stops here unless this session left a marker.
input=$(cat)
id=$(printf '%s' "$input" | sed -n 's/.*"session_id" *: *"\([A-Za-z0-9_-]*\)".*/\1/p' | head -n 1)
[ -n "$id" ] || exit 0
marker="$HOME/.cache/prg/waiting/$id"
if [ "$1" = clear ]; then
  [ -e "$marker" ] || exit 0
  waiting=$(cat "$marker")
  tool=$(printf '%s' "$input" | sed -n 's/.*"tool_name" *: *"\([^"]*\)".*/\1/p' | head -n 1)
  # A tool call clears only the tool that asked; the end of a turn or a new prompt clears whatever it was.
  if [ -n "$tool" ] && [ -n "$waiting" ] && [ "$tool" != "$waiting" ]; then
    exit 0
  fi
fi
command -v bun >/dev/null 2>&1 || exit 0
printf '%s' "$input" | bun "$(dirname "$0")/attention.mjs" "$1" >/dev/null 2>&1
exit 0
