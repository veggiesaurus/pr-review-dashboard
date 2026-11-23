#!/bin/sh
# Run by the plugin's hooks: "set" on a notification, "clear" after a tool call, at the end of a turn and on a new prompt.
# These run in every session, so they stop before reading the input unless a session waits (clear) or a dashboard runs (set).
mode=$1
if [ "$mode" = clear ]; then set -- "$HOME"/.cache/prg/waiting/*; else set -- "$HOME"/.cache/prg/*.json; fi
[ -e "$1" ] || { cat >/dev/null; exit 0; }
input=$(cat)
# The hook's own keys come first; a tool's input can repeat them further on, so take the first match.
id=$(printf '%s' "$input" | grep -o '"session_id" *: *"[A-Za-z0-9_-]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
[ -n "$id" ] || exit 0
marker="$HOME/.cache/prg/waiting/$id"
if [ "$mode" = clear ]; then
  [ -e "$marker" ] || exit 0
  tool=$(printf '%s' "$input" | grep -o '"tool_name" *: *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
  # The marker holds a tool name per line. A tool call clears only a tool that asked; the end of a turn or a new prompt clears whatever it was.
  if [ -n "$tool" ] && grep -q . "$marker" && ! grep -qxF "$tool" "$marker"; then
    exit 0
  fi
fi
command -v bun >/dev/null 2>&1 || exit 0
printf '%s' "$input" | bun "$(dirname "$0")/attention.mjs" "$mode" >/dev/null 2>&1
exit 0
