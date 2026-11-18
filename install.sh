#!/usr/bin/env bash
# dsh-screenshot — installer for Linux / macOS DSH profiles.
#
#   ./install.sh                          install into ~/.dsh/profiles/web
#   ./install.sh --profile <dir>          install into another profile
#   DSH_PROFILE=<dir> ./install.sh        same, via environment
#
# What it does
#   1. copies static/ into <profile>/node_modules/dsh-screenshot
#   2. makes @deepseek-ai/cordis resolvable from there when the profile does not
#      already provide it (symlink to the copy shipped with the dsh install)
#   3. adds ONE composition row to <profile>/cordis.patch.yml — idempotent, and
#      it repairs a pristine profile whose patch file is still the empty "[]"
#   4. backs both up under <profile>/_backup/dsh-screenshot-<timestamp>/
#
# The harness reads the composition at boot, so restart it afterwards.
set -euo pipefail

PROFILE="${DSH_PROFILE:-$HOME/.dsh/profiles/web}"
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a directory}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/static"
DEST="$PROFILE/node_modules/dsh-screenshot"
PATCH="$PROFILE/cordis.patch.yml"
MARKER="# ==== dsh-screenshot (installed by install.sh) ===="

[ -d "$PROFILE" ] || { echo "profile directory not found: $PROFILE" >&2; exit 1; }
[ -f "$SRC/package.json" ] || { echo "static/package.json not found next to install.sh" >&2; exit 1; }

# ── backup ──────────────────────────────────────────────────────────────
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$PROFILE/_backup/dsh-screenshot-$STAMP"
mkdir -p "$BACKUP"
[ -f "$PATCH" ] && cp "$PATCH" "$BACKUP/cordis.patch.yml"
[ -d "$DEST" ] && cp -a "$DEST" "$BACKUP/dsh-screenshot"
echo "backup : $BACKUP"

# ── package ─────────────────────────────────────────────────────────────
mkdir -p "$PROFILE/node_modules"
rm -rf "$DEST"
cp -a "$SRC" "$DEST"
echo "package: $DEST"

# ── dependency: @deepseek-ai/cordis (host half imports it) ──────────────
ensure_dep() {
  local name="$1"
  local dest="$PROFILE/node_modules/@deepseek-ai/$name"
  [ -e "$dest" ] && return 0
  local dsh_bin dsh_root found
  dsh_bin="$(command -v dsh || true)"
  [ -n "$dsh_bin" ] || return 1
  dsh_root="$(dirname "$(dirname "$(readlink -f "$dsh_bin")")")"
  found="$(find "$dsh_root" "$(dirname "$dsh_root")" -maxdepth 5 -type d \
    -path "*/node_modules/@deepseek-ai/$name" 2>/dev/null | head -1)"
  [ -n "$found" ] || return 1
  mkdir -p "$(dirname "$dest")"
  ln -sfn "$found" "$dest"
  echo "dep    : linked @deepseek-ai/$name -> $found"
}
ensure_dep cordis || echo "dep    : @deepseek-ai/cordis not linked (host half will warn, client half is unaffected)"

# ── composition row ─────────────────────────────────────────────────────
if grep -q "id: *dsh-screenshot" "$PATCH" 2>/dev/null; then
  echo "compose: row already present"
else
  [ -f "$PATCH" ] || { printf '%s\n' '# dsh profile patch layer' > "$PATCH"; }
  # a pristine profile ships a flow-empty sequence ("[]"); block entries cannot
  # be appended to it, so drop that lone line first
  TMP="$(mktemp)"
  awk '{ if ($0 ~ /^[[:space:]]*\[\][[:space:]]*$/) next; print }' "$PATCH" > "$TMP"
  {
    sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$TMP"
    printf '%s\n' "$MARKER" "- insert:" "    - id: dsh-screenshot" "      name: 'dsh-screenshot'"
  } > "$PATCH"
  rm -f "$TMP"
  echo "compose: row appended to $PATCH"
fi

echo ""
echo "Installed. RESTART the harness process so the composition and the client"
echo "bundle enter the boot graph (a page refresh alone is not enough)."
