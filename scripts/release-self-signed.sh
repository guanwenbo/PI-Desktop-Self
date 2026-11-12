#!/usr/bin/env bash
# Cut a release of this fork for a given version.
#
# Usage:
#   ./scripts/release-self-signed.sh <version>                 # build, verify, tag, publish
#   ./scripts/release-self-signed.sh <version> --no-publish    # stop after local verification
#   ./scripts/release-self-signed.sh <version> --no-tag        # build and verify only
#
# This is the packaging plan for every tag of this fork: there is no Apple
# Developer ID, so the bundle is signed with the pinned self-signed identity in
# scripts/self-signed-identity.conf, not notarized, and published to
# guanwenbo/PI-Desktop-Self. See docs/release-self-signed-macos.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/self-signed-identity.conf
source "$SCRIPT_DIR/self-signed-identity.conf"

REPO_SLUG="${RELEASE_REPO_SLUG:-guanwenbo/PI-Desktop-Self}"
PUBLISH=1
TAG=1

log() { printf '\n[ release ] %s\n' "$*"; }
die() {
  printf '\n[ release ] ERROR: %s\n' "$*" >&2
  exit 1
}

VERSION=""
for arg in "$@"; do
  case "$arg" in
    --no-publish) PUBLISH=0 ;;
    --no-tag) TAG=0 ;;
    -h | --help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    -*)
      die "unknown option: $arg"
      ;;
    *)
      [[ -z "$VERSION" ]] || die "only one version argument is accepted"
      VERSION="$arg"
      ;;
  esac
done

[[ -n "$VERSION" ]] || die "usage: $0 <version> [--no-publish] [--no-tag]"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must look like 1.2.3 (got: $VERSION)"
[[ "$(uname -s)" == "Darwin" ]] || die "macOS only"
[[ "$(uname -m)" == "arm64" ]] || die "this packaging plan produces arm64 artifacts only"

cd "$REPO_ROOT"

log "checking the release identity"
# A release signed by a different certificate cannot update an existing install.
AVAILABLE="$(security find-identity -v -p codesigning 2>/dev/null |
  grep -F "\"$IDENTITY\"" | head -1 || true)"
[[ -n "$AVAILABLE" ]] || die "identity \"$IDENTITY\" is not in the keychain; import the release .p12 first (docs/release-self-signed-macos.md)"
AVAILABLE_FINGERPRINT="$(printf '%s' "$AVAILABLE" | awk '{print $2}' | tr '[:lower:]' '[:upper:]')"
if [[ "$AVAILABLE_FINGERPRINT" != "$FINGERPRINT" ]]; then
  die "the keychain identity fingerprint $AVAILABLE_FINGERPRINT does not match the pinned $FINGERPRINT"
fi
log "identity ok: $IDENTITY ($FINGERPRINT)"

log "checking the working tree"
[[ -z "$(git status --porcelain)" ]] || die "working tree is dirty; commit or stash first"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$CURRENT_BRANCH" == "main" ]] || die "release from main (currently on $CURRENT_BRANCH)"
git fetch origin main
git merge --ff-only origin/main >/dev/null || die "main is not a fast-forward of origin/main"

TAG_NAME="v$VERSION"
if git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
  die "tag $TAG_NAME already exists locally"
fi
if [[ -n "$(git ls-remote --tags origin "refs/tags/$TAG_NAME")" ]]; then
  die "tag $TAG_NAME already exists on origin"
fi

log "bumping the workspace to $VERSION"
# The upstream 9-locale changelog + README gate is upstream release discipline;
# this fork releases from code, so it is skipped deliberately here.
RELEASE_DOCS_CHECK=0 node "$SCRIPT_DIR/release.mjs" "$VERSION" --skip-docs-check

export PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null || die "cargo not found; install Rust from https://rustup.rs"

log "building signed artifacts"
CSC_NAME="$IDENTITY" pnpm --filter @pi-desktop/desktop run dist:mac

APP_PATH="$REPO_ROOT/apps/desktop/release/mac-arm64/PI-Desktop.app"
DMG_PATH="$REPO_ROOT/apps/desktop/release/PI-Desktop-$VERSION-arm64.dmg"
ZIP_PATH="$REPO_ROOT/apps/desktop/release/PI-Desktop-$VERSION-arm64-mac.zip"
FEED_PATH="$REPO_ROOT/apps/desktop/release/latest-mac.yml"
for artifact in "$APP_PATH" "$DMG_PATH" "$ZIP_PATH" "$FEED_PATH"; do
  [[ -e "$artifact" ]] || die "missing build output: $artifact"
done

log "verifying the signature and the update feed"
"$SCRIPT_DIR/verify-self-signed-release.sh" "$APP_PATH"
"$SCRIPT_DIR/verify-self-signed-release.sh" "$DMG_PATH"
FEED_VERSION="$(sed -n 's/^version: *//p' "$FEED_PATH" | head -1)"
[[ "$FEED_VERSION" == "$VERSION" ]] || die "latest-mac.yml says $FEED_VERSION, expected $VERSION"

if [[ "$TAG" == "0" ]]; then
  log "build verified for $VERSION (no tag requested)"
  exit 0
fi

log "tagging $TAG_NAME and pushing"
git tag -a "$TAG_NAME" -m "PI-Desktop $VERSION (self-signed macOS release)"
git push origin main
git push origin "$TAG_NAME"

if [[ "$PUBLISH" == "0" ]]; then
  log "tagged $TAG_NAME (publish skipped); assets are in apps/desktop/release"
  exit 0
fi

log "publishing $TAG_NAME to $REPO_SLUG"
gh release create "$TAG_NAME" \
  --repo "$REPO_SLUG" \
  --title "PI-Desktop $VERSION" \
  --notes "Self-signed macOS arm64 build of PI-Desktop $VERSION.

Signed with the fork's pinned self-signed identity ($FINGERPRINT), not
notarized. Verify before installing:

  ./scripts/verify-self-signed-release.sh PI-Desktop-$VERSION-arm64.dmg" \
  "$ZIP_PATH" "$ZIP_PATH.blockmap" "$DMG_PATH" "$DMG_PATH.blockmap" "$FEED_PATH"

log "released $TAG_NAME: https://github.com/$REPO_SLUG/releases/tag/$TAG_NAME"
