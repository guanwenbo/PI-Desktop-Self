#!/usr/bin/env bash
# Install a self-signed build of this fork, verified, in one command.
#
# Usage:
#   ./scripts/install-self-signed.sh <version>            # download, verify, install
#   ./scripts/install-self-signed.sh --file <artifact>    # use a local .dmg/.zip/.app
#
# Options:
#   --dir <path>   install into <path> instead of /Applications
#   --launch       open the app after installing
#   --no-install   download and verify only (nothing is written)
#
# Works from a clone, and also standalone on a fresh machine: when the pinned
# identity config is not next to this script it is fetched from the repository.
set -euo pipefail

REPO_SLUG="${RELEASE_REPO_SLUG:-guanwenbo/PI-Desktop-Self}"
BRANCH="${RELEASE_BRANCH:-main}"
APP_NAME="PI-Desktop"

INSTALL_DIR="/Applications"
LAUNCH=0
DO_INSTALL=1
VERSION=""
ARTIFACT=""

log() { printf '\n[ install ] %s\n' "$*"; }
die() {
  printf '\n[ install ] ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      ARTIFACT="${2:-}"
      shift 2 || die "--file requires a path"
      ;;
    --dir)
      INSTALL_DIR="${2:-}"
      shift 2 || die "--dir requires a path"
      ;;
    --launch)
      LAUNCH=1
      shift
      ;;
    --no-install)
      DO_INSTALL=0
      shift
      ;;
    -h | --help)
      sed -n '2,17p' "$0"
      exit 0
      ;;
    -*)
      die "unknown option: $1"
      ;;
    *)
      [[ -z "$VERSION" ]] || die "only one version argument is accepted"
      VERSION="$1"
      shift
      ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "macOS only"
[[ -n "$VERSION" || -n "$ARTIFACT" ]] || die "give a version (e.g. 0.24.0) or --file <artifact>"

SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
CONF="${SCRIPT_DIR:+$SCRIPT_DIR/}self-signed-identity.conf"
if [[ -f "$CONF" ]]; then
  # shellcheck source=scripts/self-signed-identity.conf
  source "$CONF"
else
  log "fetching the pinned identity config"
  REMOTE_CONF="$(curl -fsSL --max-time 30 "https://raw.githubusercontent.com/$REPO_SLUG/$BRANCH/scripts/self-signed-identity.conf")" ||
    die "cannot fetch self-signed-identity.conf from $REPO_SLUG"
  IDENTITY="$(printf '%s\n' "$REMOTE_CONF" | sed -n 's/^IDENTITY="\(.*\)"$/\1/p')"
  FINGERPRINT="$(printf '%s\n' "$REMOTE_CONF" | sed -n 's/^FINGERPRINT="\(.*\)"$/\1/p')"
fi
[[ -n "${FINGERPRINT:-}" ]] || die "the pinned fingerprint is missing"

EXPECTED_FINGERPRINT="$(printf '%s' "$FINGERPRINT" | tr '[:lower:]' '[:upper:]')"
WORK_DIR=""
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

if [[ -z "$ARTIFACT" ]]; then
  ARCHIVE_NAME="$APP_NAME-$VERSION-arm64.dmg"
  ARTIFACT_URL="https://github.com/$REPO_SLUG/releases/download/v$VERSION/$ARCHIVE_NAME"
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pi-install.XXXXXX")"
  ARTIFACT="$WORK_DIR/$ARCHIVE_NAME"
  log "downloading $ARCHIVE_NAME"
  curl -fL --progress-bar --max-time 1800 -o "$ARTIFACT" "$ARTIFACT_URL" ||
    die "download failed: $ARTIFACT_URL"
fi

[[ -e "$ARTIFACT" ]] || die "no such artifact: $ARTIFACT"

if [[ "$ARTIFACT" == *.dmg ]]; then
  MOUNT_POINT="$(mktemp -d "${TMPDIR:-/tmp}/pi-install-mnt.XXXXXX")"
  hdiutil attach "$ARTIFACT" -nobrowse -readonly -quiet -mountpoint "$MOUNT_POINT" >/dev/null
  APP_SRC="$(find "$MOUNT_POINT" -maxdepth 2 -name "$APP_NAME.app" -type d -print -quit)"
elif [[ "$ARTIFACT" == *.zip ]]; then
  WORK_DIR="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/pi-install.XXXXXX")}"
  ditto -x -k "$ARTIFACT" "$WORK_DIR"
  APP_SRC="$(find "$WORK_DIR" -maxdepth 2 -name "$APP_NAME.app" -type d -print -quit)"
else
  APP_SRC="$ARTIFACT"
fi
[[ -n "${APP_SRC:-}" && -d "$APP_SRC" ]] || die "$APP_NAME.app not found inside $ARTIFACT"

log "verifying the signature"
codesign --verify --deep --strict "$APP_SRC" 2>&1 || die "code signature is missing or damaged"
ACTUAL_REQUIREMENT="$(codesign -d -r- "$APP_SRC" 2>&1 | sed -n 's/^designated => //p' | head -1)"
ACTUAL_FINGERPRINT="$(printf '%s' "$ACTUAL_REQUIREMENT" |
  sed -n 's/.*certificate leaf = H"\([0-9a-f]*\)".*/\1/p' |
  tr '[:lower:]' '[:upper:]')"
[[ "$ACTUAL_FINGERPRINT" == "$EXPECTED_FINGERPRINT" ]] ||
  die "signed by the wrong certificate (expected $EXPECTED_FINGERPRINT, got ${ACTUAL_FINGERPRINT:-none})"
log "signature ok: $(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP_SRC/Contents/Info.plist" 2>/dev/null || echo unknown)"

if [[ "$DO_INSTALL" == "0" ]]; then
  log "verified only (--no-install); nothing was written"
  exit 0
fi

if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  die "$APP_NAME is running; quit it and run this again"
fi

APP_DST="$INSTALL_DIR/$APP_NAME.app"
if [[ -d "$APP_DST" ]]; then
  BACKUP="$APP_DST.bak-$(date +%Y%m%d%H%M%S)"
  log "backing up the current install to $BACKUP"
  mv "$APP_DST" "$BACKUP"
fi

log "installing to $APP_DST"
ditto "$APP_SRC" "$APP_DST"
xattr -dr com.apple.quarantine "$APP_DST" 2>/dev/null || true

log "installed $APP_NAME $(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP_DST/Contents/Info.plist" 2>/dev/null || echo unknown)"

if [[ "$LAUNCH" == "1" ]]; then
  open "$APP_DST"
fi
