# WilmAI Home 0.1.0 Beta: releasing from this Mac

The release is built, signed and checked on the local MacBook. CI and a signing
Mini can come later. Nothing here uploads files, creates a GitHub release or
deploys the website. The working tree must be clean before a public package is
prepared.

## One download per platform

The beta has two downloads, version **0.1.0** with a visible **Beta** label:
**WilmAI Home for Apple Silicon Macs** and **WilmAI Home for Windows** (10 or
11, x64; offered since 21 October 2026, after it ran on a student's school
laptop). The website lists both from `apps/site/lib/home-release.json`, each
"coming soon" until it has a URL.

The Mac download includes local AI as an option: the
app bundles the pinned llama.cpp Metal runtime (about 31 MB), and the 9.1 GB of
models download only when the parent chooses local AI in Settings. The models
live outside the app, in `~/Library/Application Support/ai.wilm.home/local-ai`,
so updates never download them again.

Settings shows all three choices (No AI, OpenAI, Local AI). On a Mac that can't
run local AI (less than 16 GB of memory), Local AI is greyed out with the reason.
Mac packages declare macOS 13.3 as the minimum; the runtime does too. Intel Macs
aren't built: the local AI runtime is Apple Silicon only.

How it's wired: Tauri merges `src-tauri/tauri.macos.conf.json` into every Mac
build, which turns on the `local-ai` Cargo feature, prepares the runtime and
bundles it. Windows and Linux builds leave it out (`tauri.windows.conf.json`,
`tauri.linux.conf.json`), and their Settings show Local AI greyed out. Windows
also has no desktop notifications yet. Linux isn't offered.

```sh
pnpm app                 # development, with local AI on a Mac
pnpm build:app           # an installer for this computer
pnpm install:app         # build and install in /Applications (ad hoc signed)
```

The Windows build is made on this Mac (first done 21 October 2026, for a test
on a school laptop, where it ran). One-time tools:
`brew install llvm lld nsis`, `rustup target add x86_64-pc-windows-msvc`,
`cargo install --locked cargo-xwin` (it downloads Microsoft's Windows libraries
on the first build). Then:

```sh
PATH="/opt/homebrew/opt/llvm/bin:$PATH" pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
```

This builds `src-tauri/target/x86_64-pc-windows-msvc/release/wilmai-home.exe`,
which runs as it is (no install; Windows 10/11 have the WebView2 it needs).
Homebrew's makensis 3.13 then crashes (`std::bad_alloc` in StrFunc), so package
the installer with NSIS 3.11 in a container, using the script Tauri wrote
(Debian 12's NSIS 3.08 is too old for it):

```sh
cd src-tauri/target/x86_64-pc-windows-msvc/release/nsis/x64
T=$(cd ../../../../.. && pwd); C=~/Library/Caches/tauri
docker run --rm --platform linux/amd64 -v "$T:$T" -v "$C:$C" -w "$PWD" debian:trixie-slim \
  sh -c 'apt-get update -qq && apt-get install -y -qq nsis && makensis -INPUTCHARSET UTF8 installer.nsi'
```

That writes `nsis-output.exe`, the installer (per user, no administrator
rights). Neither is signed, so Windows SmartScreen warns ("More info" → "Run
anyway"), and a school-managed machine may not allow it at all; the website
says so beside the download. Desktop notifications aren't implemented on
Windows yet.

To publish it, name the installer `WilmAI-Home-<version>-beta-windows-x64.exe`
(`assetName` in scripts/home-release.ts), add it to the same `home-v<version>`
GitHub release as the Mac files, and put its URL in the `windows-x64` entry of
`home-release.json`. Updates on Windows: a build without the updater key shows
the update notice with a link to the website, where the new installer is. With
the key, build with the same updater settings as the Mac release, sign the
installer (`pnpm tauri signer sign`), and from then on every `latest.json` must
carry a `windows-x86_64` entry next to `darwin-aarch64`: a signed Windows app
finds no update in a feed without its platform.

Windows code signing needs its own certificate or signing service; Apple's
Developer ID can't sign a Windows installer.

School and work networks: the app's own connections (Wilma, OpenAI) use the
computer's proxy settings and its installed certificates, as a browser would.
When the network blocks OpenAI, Settings says so before a key is added, and AI
pauses for five minutes at a time (then one quick check) instead of retrying.

## One-time credentials

The Mac release needs two different signatures:

1. An **Apple Developer ID Application** certificate and private key in this
   Mac's Keychain, plus notarization credentials. Keep a recoverable backup of
   the certificate, its private key and password in 1Password.
2. A **Tauri updater signing key**, kept and backed up in 1Password. Only the
   public key belongs in `src-tauri/updater.pub` and in the app. Keep the same
   key for every beta fix: losing it breaks updates for everyone who installed
   the app.

The updater key was generated on 22 October 2026 with Tauri's interactive
`signer generate`, into `~/.tauri/wilmai-home.key` (encrypted with its
password). The key file and its password are in 1Password, Personal vault
(my.1password.com), "WilmAI Home updater key": `private key` and `credential`.
Only the public key is in the repository (`src-tauri/updater.pub`).

The release command reads these environment variables. It never writes secret
values into config files or prints them:

- `APPLE_SIGNING_IDENTITY`: the Developer ID Application certificate's name.
- `TAURI_SIGNING_PRIVATE_KEY`: the updater key's contents or path.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: if the updater key is encrypted.
- Notarization: `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`, or
  `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.

A 1Password Developer Environment can hand these to the release process. Tauri
reads inherited environment variables, not `.env` files, so a mounted file alone
isn't enough. Never commit a private key or a mount.

## A beta without Apple's and Microsoft's certificates

Until the Developer ID and a Windows signing service exist, releases are signed
only for updates. That's how 0.1.0 went out (22 October 2026): macOS asks for
"Open Anyway" the first time and Windows for "Run anyway" (the Home page says
how), and from then on new versions install inside the app, checked against the
updater key. One `op read` of the key's password covers a whole release:

```sh
export TAURI_SIGNING_PRIVATE_KEY=~/.tauri/wilmai-home.key
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(op read --account my.1password.com 'op://Personal/WilmAI Home updater key/credential')"
CONF='{"bundle":{"createUpdaterArtifacts":true,"macOS":{"signingIdentity":"-"}},"plugins":{"updater":{"pubkey":"<src-tauri/updater.pub>","endpoints":["https://wilm.ai/app/latest.json"]}}}'
pnpm tauri build --bundles app,dmg --config "$CONF"     # the DMG, and the .app.tar.gz with its .sig for updates
PATH="/opt/homebrew/opt/llvm/bin:$PATH" pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis --config "$CONF"
```

Package the Windows installer in the container (above), name the assets with
`assetName` (`…-macos-arm64.dmg`, `…-macos-arm64.app.tar.gz`,
`…-windows-x64.exe`), and sign the Windows installer for updates: the bundler's
own signing step comes after the makensis that fails here.

Finish the Mac DMG: `sh scripts/finish-dmg.sh "<Tauri's .dmg>" WilmAI-Home-<v>-beta-macos-arm64.dmg`.
It adds the background (`desktop-assets/dmg/background.tiff`: drag to
Applications, and the first-start steps with a sketch of Open Anyway), a link
to System Settings' Privacy & Security (Finder won't open a `.webloc` to
System Settings; the old `Security.prefPane` still opens the pane), keeps
`.background` and `.VolumeIcon.icns` hidden (Finder drops the volume icon while
it writes the layout, so the script puts it back) and lays the window out. To
change the background, edit `desktop-assets/dmg/background.html`, screenshot
it at 660×560 at 1× and 2×, and combine them with `tiffutil -cathidpicheck`.

```sh
env -u TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/wilmai-home.key pnpm tauri signer sign WilmAI-Home-<v>-beta-windows-x64.exe
pnpm home:feed darwin-aarch64=<…>.app.tar.gz.sig windows-x86_64=<…>.exe.sig    # writes apps/site/public/app/latest.json
```

Then a `home-v<version>` pre-release on GitHub (`--prerelease --latest=false`,
so the CLI keeps "Latest") with the DMG, the `.app.tar.gz`, the installer and
SHA256SUMS; the download URLs in `apps/site/lib/home-release.json`; and a push
of `main`, which deploys the page and the feed together. Raise the version in
package.json, Cargo.toml, tauri.conf.json and home-release.json first, and
write `docs/releases/<version>.md`: its first paragraph is the update notice.

## Prepare the Mac release

Review and commit the changes first; don't discard anything to get a clean tree.

```sh
pnpm release:check       # prerequisites only
pnpm release:build       # build, sign, notarize, check
```

The check wants matching versions in package.json, Cargo.toml, tauri.conf.json
and the website's `apps/site/lib/home-release.json`, a clean tree, a tracked
public updater key, the Developer ID certificate, and the notarization and
updater credentials. The build runs the typecheck and the AI, release and native
tests, signs the app and its bundled runtime, notarizes and staples the app and
the DMG, and writes to `.release/0.1.0/macos-arm64/`:

- `WilmAI-Home-0.1.0-beta-macos-arm64.dmg`, the download;
- the signed `.app.tar.gz` and its `.sig`, for updates;
- `SHA256SUMS`;
- a draft `latest.json` and `download-entry.json`.

The output is ignored by Git. These files are candidates to review, not a
release. Today the check stops on: the uncommitted changes, the missing updater
key, the missing Developer ID certificate and the missing notarization
credentials.

The development install printed a harmless `rust-objcopy` warning about a
missing `libLLVM.dylib`; repair Rust's LLVM tools before public packaging.

## Rehearse an update, then publish when approved

Before any public download, prove an update with two signed builds and a private
test feed. Public 0.1.0 can be tested against a temporary 0.0.x build, which is
removed afterwards. Check:

- the older build finds the newer one by itself and with Check now, also signed
  out and with the window closed;
- download progress, Later, an offline retry, and a rejected bad signature;
- install and restart reach the new version, and a failed download leaves the
  old app working;
- accounts, cached messages, drafts, the OpenAI key, the monthly limit and the
  AI choice survive;
- local AI stops cleanly for the restart, and the models aren't downloaded again
  (don't download real model weights just for this test);
- the DMG opens normally after a browser download, with macOS's protections on.

The gate is a shown update between two builds, not a successful build or a
faked update notice. Keep `ai.wilm.home` as the app identifier and the existing
data locations.

When approved:

1. Upload the assets to a dedicated `home-v0.1.0` GitHub release (never the
   CLI's rolling `releases/latest`). Check the hashes and a browser download.
2. Publish the feed at `https://wilm.ai/app/latest.json`, served directly with
   HTTP 200 (the app's checker doesn't follow redirects). One file serves every
   platform: when Windows or Linux are added, combine their entries under
   `platforms` for the same version, never mixing versions. Signatures are the
   `.sig` file's **contents**, not a link to it.
3. Put the DMG's URL in `apps/site/lib/home-release.json`. The Home page's
   download button turns on by itself.
4. Deploy the site only when approved: a push to `main` deploys it.

To withdraw a bad release, put the feed back to the last good version, then ship
a fix with a higher version number. Every fix raises the version in
package.json, Cargo.toml, tauri.conf.json and the website together; the Beta
label stays until the app leaves beta.

## Downloads

```sh
pnpm release:downloads   # here, or `pnpm stats` from the repository's root
```

Prints GitHub's download counts for every Home release: the Mac and Windows
installers, and the Mac update archive, which only an installed app downloads
when it updates itself (a Windows app updates with the installer, so those
counts include updates). Replacing a file in a release starts its count from
zero. Then, from Cloudflare's request analytics for wilm.ai (read with the
`cf` CLI), per day: front page and Home page views, downloads from the site's
buttons (`/get/mac`, `/get/windows`, which forward to the installers on
GitHub), counting browsers only (not known bots, crawlers, curl or scripts)
and leaving out hours when someone scanned the site (at least 40% of the
requests for pages that don't exist), and the update checks of installed
apps. A running app checks at
start and every 6 hours, so
about four checks a day are one app in use. Released apps check as
`tauri-plugin-updater/…`, older and development builds as `WilmAI-Home/…`.

These are counts that exist anyway. Repeated downloads count again, so they
aren't unique users; GitHub doesn't say who downloaded, and the script reads no
addresses or anything else about a person. The app itself has no tracking or
analytics.

References: [Tauri updater](https://v2.tauri.app/plugin/updater/),
[Mac signing](https://v2.tauri.app/distribute/sign/macos/),
[Windows installers and cross-compiling](https://v2.tauri.app/distribute/windows-installer/).
