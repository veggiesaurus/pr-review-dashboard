#!/bin/sh
# Run by the plugin's PermissionRequest hook. Whatever goes wrong, it exits 0 with no output, which leaves the terminal's dialog.
# With no dashboard state file there is no page to ask, so it stops before starting bun.
set -- "$HOME"/.cache/prg/*.json
[ -e "$1" ] || { cat >/dev/null; exit 0; }
command -v bun >/dev/null 2>&1 || exit 0
bun "$(dirname "$0")/permission.mjs" 2>/dev/null
exit 0
