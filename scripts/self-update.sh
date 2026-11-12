#!/usr/bin/env bash
# Rebuild this fork from source and install it into /Applications.
#
# The bundle produced here is not Developer ID signed, so the in-app Squirrel
# updater cannot install it; this script is the update path for local,
# self-maintained builds. Use --no-install to only build.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="PI-Desktop"
INSTALL_DIR="${SELF_UPDATE_INSTALL_DIR:-/Applications}"
BRANCH="${SELF_UPDATE_BRANCH:-main}"
SKIP_INSTALL=0

if [[ "${1:-}" == "--no-install" ]]; then
  SKIP_INSTALL=1
fi

log() { printf '\n[ self-update ] %s\n' "$*"; }
die() {
  printf '\n[ self-update ] ERROR: %s\n' "$*" >&2
  exit 1
}

cd "$REPO_ROOT"

[[ "$(uname -s)" == "Darwin" ]] || die "this script supports macOS only"
[[ "$(uname -m)" == "arm64" ]] || die "this script packages arm64 only"

# Uncommitted work would be silently carried into the build, so stop instead.
if [[ -n "$(git status --porcelain)" ]]; then
  die "working tree is dirty; commit or stash your changes first"
fi

# Replacing a running bundle would leave the old process serving the old code,
# so fail here rather than after a full rebuild.
if [[ "$SKIP_INSTALL" != "1" ]] && pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  die "$APP_NAME is running; quit it and run this script again"
fi

log "fetching origin/$BRANCH"
git fetch origin "$BRANCH"
git merge --ff-only "origin/$BRANCH" >/dev/null
log "building $(git rev-parse --short HEAD) $(git log -1 --format=%s)"

export PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null || die "cargo not found; install Rust from https://rustup.rs"
command -v pnpm >/dev/null || die "pnpm not found"

log "installing dependencies"
pnpm install --frozen-lockfile

# shellcheck source=scripts/self-signed-identity.conf
source "$REPO_ROOT/scripts/self-signed-identity.conf"
SIGNING_IDENTITY="${SELF_UPDATE_SIGNING_IDENTITY:-$IDENTITY}"
if security find-identity -v -p codesigning 2>/dev/null | grep -qF "$SIGNING_IDENTITY"; then
  log "signing with $SIGNING_IDENTITY"
  export CSC_NAME="$SIGNING_IDENTITY"
else
  log "WARNING: no '$SIGNING_IDENTITY' identity; building unsigned, and in-app updates will not install"
  export CSC_IDENTITY_AUTO_DISCOVERY=false
fi

log "building macOS bundle"
pnpm --filter @pi-desktop/desktop run dist:mac

APP_SRC="$REPO_ROOT/apps/desktop/release/mac-arm64/$APP_NAME.app"
[[ -d "$APP_SRC" ]] || die "build output missing at $APP_SRC"

if [[ "$SKIP_INSTALL" == "1" ]]; then
  log "build ready at $APP_SRC (--no-install)"
  exit 0
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

INSTALLED_VERSION="$(defaults read "$APP_DST/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo unknown)"
log "installed $APP_NAME $INSTALLED_VERSION; launch it from $INSTALL_DIR"
