#!/usr/bin/env bash
# Verify that a macOS artifact was signed by this fork's release identity.
#
# Usage:
#   ./scripts/verify-self-signed-release.sh <PI-Desktop.app | .dmg | .zip>
#
# Run it on any machine before installing a build downloaded from this fork's
# releases. It accepts an app bundle, a DMG or a ZIP, and checks:
#   1. the code signature is intact (codesign --verify --deep --strict)
#   2. the signing certificate leaf equals the pinned fingerprint
#   3. the designated requirement is the pinned one, which is what Squirrel.Mac
#      compares before installing an in-app update
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/self-signed-identity.conf
source "$SCRIPT_DIR/self-signed-identity.conf"

EXPECTED_FINGERPRINT="$(printf '%s' "$FINGERPRINT" | tr '[:lower:]' '[:upper:]')"

usage() {
  echo "Usage: $0 <PI-Desktop.app | PI-Desktop-*.dmg | PI-Desktop-*.zip>" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
ARTIFACT="$1"
[[ -e "$ARTIFACT" ]] || {
  echo "error: no such artifact: $ARTIFACT" >&2
  exit 1
}

WORK_DIR=""
APP_PATH=""
MOUNT_POINT=""

cleanup() {
  if [[ -n "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet -force >/dev/null 2>&1 || true
  fi
  if [[ -n "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

find_app() {
  find "$1" -maxdepth 2 -name "PI-Desktop.app" -type d -print -quit
}

case "$ARTIFACT" in
  *.app)
    APP_PATH="$ARTIFACT"
    ;;
  *.dmg)
    MOUNT_POINT="$(mktemp -d "${TMPDIR:-/tmp}/pi-verify-dmg.XXXXXX")"
    hdiutil attach "$ARTIFACT" -nobrowse -readonly -quiet -mountpoint "$MOUNT_POINT" >/dev/null
    APP_PATH="$(find_app "$MOUNT_POINT")"
    ;;
  *.zip)
    WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pi-verify-zip.XXXXXX")"
    ditto -x -k "$ARTIFACT" "$WORK_DIR"
    APP_PATH="$(find_app "$WORK_DIR")"
    ;;
  *)
    usage
    ;;
esac

[[ -n "$APP_PATH" && -d "$APP_PATH" ]] || {
  echo "error: PI-Desktop.app not found inside $ARTIFACT" >&2
  exit 1
}

echo "==> verifying $APP_PATH"

if ! codesign --verify --deep --strict "$APP_PATH" 2>&1; then
  echo "FAIL: code signature is missing or damaged" >&2
  exit 1
fi

ACTUAL_IDENTITY="$(codesign -dv --verbose=2 "$APP_PATH" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
ACTUAL_REQUIREMENT="$(codesign -d -r- "$APP_PATH" 2>&1 | sed -n 's/^designated => //p' | head -1)"
ACTUAL_FINGERPRINT="$(printf '%s' "$ACTUAL_REQUIREMENT" |
  sed -n 's/.*certificate leaf = H"\([0-9a-f]*\)".*/\1/p' |
  tr '[:lower:]' '[:upper:]')"

if [[ "$ACTUAL_FINGERPRINT" != "$EXPECTED_FINGERPRINT" ]]; then
  echo "FAIL: signed by the wrong certificate" >&2
  echo "  expected fingerprint: $EXPECTED_FINGERPRINT" >&2
  echo "  actual:               ${ACTUAL_FINGERPRINT:-<none>}" >&2
  echo "  requirement:          ${ACTUAL_REQUIREMENT:-<none>}" >&2
  exit 1
fi

echo "  identity:    ${ACTUAL_IDENTITY:-<none>}"
echo "  requirement: $ACTUAL_REQUIREMENT"
echo "  version:     $(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo unknown)"
echo "OK: signature and designated requirement match the pinned release identity"
