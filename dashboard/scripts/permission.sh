#!/bin/sh
# Run by the plugin's PermissionRequest hook. Whatever goes wrong, it exits 0 with no output, which leaves the terminal's dialog.
command -v bun >/dev/null 2>&1 || exit 0
bun "$(dirname "$0")/permission.mjs" 2>/dev/null
exit 0
