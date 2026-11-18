#!/usr/bin/env bash
# dsh-screenshot — uninstaller for Linux / macOS DSH profiles.
#
#   ./uninstall.sh                    remove from ~/.dsh/profiles/web
#   ./uninstall.sh --profile <dir>    remove from another profile
#   ./uninstall.sh --restore-backup   put the newest _backup/dsh-screenshot-*
#                                     back (patch file + package directory)
#
# The composition row is removed by line scan (the marker line plus the four
# lines of its insert entry), so neighbouring entries are never touched.
set -euo pipefail

PROFILE="${DSH_PROFILE:-$HOME/.dsh/profiles/web}"
RESTORE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a directory}"; shift 2 ;;
    --restore-backup) RESTORE=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

PATCH="$PROFILE/cordis.patch.yml"
DEST="$PROFILE/node_modules/dsh-screenshot"
LINK="$PROFILE/node_modules/@deepseek-ai/cordis"
MARKER="# ==== dsh-screenshot (installed by install.sh) ===="

[ -d "$PROFILE" ] || { echo "profile directory not found: $PROFILE" >&2; exit 1; }

if [ "$RESTORE" = 1 ]; then
  BACKUP="$(ls -1dt "$PROFILE"/_backup/dsh-screenshot-* 2>/dev/null | head -1 || true)"
  [ -n "$BACKUP" ] || { echo "no backup found under $PROFILE/_backup" >&2; exit 1; }
  echo "restoring from: $BACKUP"
  [ -f "$BACKUP/cordis.patch.yml" ] && cp "$BACKUP/cordis.patch.yml" "$PATCH"
  if [ -d "$BACKUP/dsh-screenshot" ]; then
    mkdir -p "$PROFILE/node_modules"
    rm -rf "$DEST"
    cp -a "$BACKUP/dsh-screenshot" "$DEST"
  fi
  echo "Restored. Restart the harness process."
  exit 0
fi

# ── composition row ─────────────────────────────────────────────────────
if [ -f "$PATCH" ] && grep -qF "$MARKER" "$PATCH"; then
  TMP="$(mktemp)"
  awk -v marker="$MARKER" '
    $0 == marker { skip = 1; next }
    skip == 1 {
      # drop the insert entry that belongs to the marker, then stop skipping
      if ($0 ~ /^[[:space:]]*name:/) { skip = 0 }
      next
    }
    { print }
  ' "$PATCH" > "$TMP"
  cp "$TMP" "$PATCH"
  rm -f "$TMP"
  echo "compose: row removed"
else
  echo "compose: no row found (nothing to remove)"
fi

# ── package + dependency shim ───────────────────────────────────────────
if [ -d "$DEST" ]; then
  BACKUP="$PROFILE/_backup/dsh-screenshot-removed-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP"
  mv "$DEST" "$BACKUP/dsh-screenshot"
  echo "package: moved to $BACKUP/dsh-screenshot"
else
  echo "package: not installed"
fi
if [ -L "$LINK" ]; then
  rm -f "$LINK"
  echo "dep    : removed cordis symlink"
fi

echo ""
echo "Removed. Restart the harness process to drop the composition entry."
