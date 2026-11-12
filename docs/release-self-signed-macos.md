# Self-signed macOS releases

This fork has no Apple Developer ID. Every macOS release is signed with a
self-signed certificate instead of being Developer ID signed and notarized.
This document is the packaging plan for **every tag** on this repository.

## Why a self-signed certificate still supports in-app updates

`electron-updater` on macOS hands the downloaded ZIP to the native
Squirrel.Mac installer, which only installs an update whose signature
satisfies the **designated requirement** baked into the currently running
app.

A Developer ID signature produces a requirement bound to the team
certificate; an ad-hoc signature produces a requirement bound to a per-build
`cdhash`, so every build rejects every other build. A self-signed
certificate produces a stable requirement instead:

```text
identifier "net.aiuo.pi-desktop" and certificate leaf = H"a982bd01c82a36858f4e5856c262e94cdccd917b"
```

That value depends only on the certificate, not on the build, so an update
built on another machine installs as long as it carries the **same**
certificate. The pinned values live in
[`scripts/self-signed-identity.conf`](../scripts/self-signed-identity.conf).

Changing that certificate breaks in-app updates for every build already
installed: those installs compare against the requirement in the app they
are running, so a new certificate is only reachable through a manual
install.

## One-time certificate setup

Create the certificate once, on the first machine that publishes releases.

```bash
# 1. Self-signed code-signing certificate (Keychain Access → Certificate
#    Assistant → Create a Certificate → Certificate Type: Code Signing also
#    works; this is the scripted equivalent).
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes \
  -subj "/CN=PI-Desktop Self Signed" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  -addext "basicConstraints=critical,CA:false"

# 2. Bundle it with a password (macOS rejects an empty PKCS#12 password).
openssl pkcs12 -export -inkey key.pem -in cert.pem -out selfsign.p12 \
  -passout pass:pidesktop -name "PI-Desktop Self Signed"

# 3. Import and pre-authorize codesign. -A avoids a Keychain prompt on every
#    signing run; -T lets codesign use the key.
security import selfsign.p12 -k "$HOME/Library/Keychains/login.keychain-db" \
  -P pidesktop -T /usr/bin/codesign -A

# 4. Confirm it is usable and record the fingerprint.
security find-identity -v -p codesigning
```

The fingerprint printed there (`A982BD01…917B` for this fork) must match
`FINGERPRINT` in `scripts/self-signed-identity.conf`. Every release script
asserts this before building.

### Copying the identity to another build machine

Only machines that **publish** releases need the certificate; machines that
only install the app need nothing.

```bash
# On the existing machine: export once, keep the file out of the repository.
security export -k "$HOME/Library/Keychains/login.keychain-db" -t identities \
  -f pkcs12 -o ~/pi-desktop-selfsign.p12

# On the new machine: import, then check the fingerprint matches the pinned one.
security import ~/pi-desktop-selfsign.p12 -k "$HOME/Library/Keychains/login.keychain-db" \
  -P <password> -T /usr/bin/codesign -A
security find-identity -v -p codesigning
```

Treat the `.p12` as a release credential: never commit it, never attach it
to an issue, and keep a backup somewhere safe. Losing it means new builds
can no longer update existing installs.

## Per-tag packaging plan

```bash
# 1. Be on an up-to-date, clean main.
git switch main && git pull --ff-only

# 2. Cut the release: bump versions, build signed artifacts, verify the
#    signature and the feed, tag, push, publish to GitHub.
./scripts/release-self-signed.sh 0.24.0
```

The script refuses to continue unless all of these hold:

| Gate | Why |
| --- | --- |
| The pinned identity is in the keychain, fingerprint matches | A release signed by another certificate cannot update installs |
| Working tree clean, on `main`, fast-forward of `origin/main` | The tag must describe real committed code |
| `v<version>` absent locally and on origin | Tags are immutable release points |
| `codesign --verify --deep --strict` passes | Detects a broken or stripped signature |
| Designated requirement equals the pinned fingerprint | This is exactly what Squirrel.Mac checks |
| `latest-mac.yml` version equals the release version | A mismatched feed silently withholds the update |

Partial runs:

```bash
./scripts/release-self-signed.sh 0.24.0 --no-tag       # build + verify only
./scripts/release-self-signed.sh 0.24.0 --no-publish   # tag, keep assets local
```

### What the release publishes

`PI-Desktop-<version>-arm64.dmg`, `PI-Desktop-<version>-arm64-mac.zip`, both
`.blockmap` files, and `latest-mac.yml`. The ZIP is what the in-app updater
downloads; the DMG is what people install manually the first time.

## Installing on another machine

```bash
# 1. Download the DMG from the tag's release page.

# 2. Verify it was signed by this fork before installing anything.
./scripts/verify-self-signed-release.sh PI-Desktop-<version>-arm64.dmg

# 3. Install (no quarantine attribute, so Gatekeeper does not block the
#    unsigned-from-Apple bundle).
hdiutil attach PI-Desktop-<version>-arm64.dmg -nobrowse
ditto "/Volumes/PI-Desktop/PI-Desktop.app" /Applications/PI-Desktop.app
hdiutil detach "/Volumes/PI-Desktop"
xattr -dr com.apple.quarantine /Applications/PI-Desktop.app
```

The first install is always manual: no already-installed app is signed with
this certificate yet, so there is nothing for Squirrel to match against.

## Updating after that

Two paths, both supported:

* **In-app** — the installed app checks this repository's releases and
  installs newer builds silently, because they carry the same certificate.
* **Rebuild locally** — [`scripts/self-update.sh`](../scripts/self-update.sh)
  pulls `main`, rebuilds with the pinned identity, and replaces
  `/Applications/PI-Desktop.app`.

Application data is untouched by either path: sessions, projects and
encrypted secrets live in `~/.pi-desktop`, not inside the bundle. The
`safeStorage` key in the Keychain may prompt once the first time a
differently signed build reads it; choosing "Always Allow" keeps it working.

## Continuous integration

`.github/workflows/release.yml` (upstream's Developer ID + notarization lane)
no longer triggers on tag pushes in this fork — it requires credentials this
fork does not have. Releases are produced by the local script above.

If tag-driven CI is ever wanted, store the same certificate as repository
secrets (`CSC_LINK` = base64 of the `.p12`, `CSC_KEY_PASSWORD`) and run
`electron-builder --mac --publish never` with `CSC_NAME` set to the pinned
identity. Notarization must stay off: there is no Apple account to notarize
with, and a different signing identity would break updates for existing
installs.
