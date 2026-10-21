# WilmAI Home: desktop update readiness

Audited and updated 10 October 2026. This preparation is uncommitted and unpublished.

## Where it stands (10 October 2026)

Done, uncommitted and unpublished:

- The Tauri updater, with signed downloads, progress, a separate Install and
  restart, and local AI stopped cleanly before the restart.
- A failed or offline check keeps an update already found and never claims the
  app is up to date.
- Updates can be reached before sign-in and from the menu bar.
- **One Mac download** for Apple Silicon, with local AI included as an option
  (`src-tauri/tauri.macos.conf.json`). Windows and Linux builds leave local AI
  out and aren't offered yet. One update feed, `/app/latest.json`, for every
  platform.
- Version **0.1.0** with a visible **Beta** label.
- The Mac release commands (`pnpm release:check`, `pnpm release:build`) and a
  download count command.
- The website's WilmAI Home pages (`/en/home`, `/fi/home`), with the download
  shown as coming until a signed build and an update have been tested. The front
  page stays about AI assistants, with one line pointing to Home.

The development config has no updater public key on purpose; the release
command adds the real one from `src-tauri/updater.pub`, and the feed. No
production key or Apple signing identity exists yet. Still to do: the Apple
Developer account and certificate, the updater key in 1Password, a shown update
between two signed builds, and local AI on a 16 GB Mac. See
[releasing from this Mac](local-releases.md). The rest of this file is the
original audit.

## Original audit state (before the preparation above)

We have update discovery and notices, but do not yet have in-app installation of updates. The current local build should not be the first public download if we want people to receive fixes through the app.

| Part | Evidence | Status |
| --- | --- | --- |
| Automatic checks | `src/main.tsx` starts `src/data/updates.ts`: first check after 15 seconds, then every six hours; enabled by default | Implemented |
| Manual check and opt-out | Settings → Updates includes Check now and Look for new versions | Implemented |
| Update notice | Top-bar dot opens notes and a Get the new version link in `src/ui/Update.tsx` | Implemented; manual download only |
| Feed | Native command requests `https://wilm.ai/app/latest.json` | Live endpoint returned HTTP 404 during the audit |
| Download page | Current manifest convention links to `https://wilm.ai/app` | Live page returned HTTP 404 during the audit |
| In-app installer | No updater plugin, updater public key, permissions or `createUpdaterArtifacts` setting in the app | Missing |
| Public Mac signing | Installed build has an ad-hoc signature, no TeamIdentifier and no stapled notarization ticket; no Developer ID Application identity found on this Mac | Not ready for public distribution |
| Release automation | Existing workflows test the client/CLI/site and release the Claude Desktop extension | No Home build or release job |
| Release numbering | Tauri configuration and Cargo package both currently say `0.1.0` | Must increment together for every public fix; the Git build stamp does not trigger updates |

Source locations: `src/data/updates.ts`, `src/ui/Update.tsx`, `src-tauri/src/lib.rs` (the `update_manifest` command), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the repository's `.github/workflows/` directory.

## Release gates identified by the audit

1. **Distinguish failed checks from successful checks.** The native command returns no release for every non-success HTTP status or malformed manifest. The frontend also records a check timestamp after network failures. Settings interprets that timestamp as proof that the installed version is newest. A missing feed, 500, malformed JSON or offline check must instead show an unavailable/failed status and allow retry. Preserve a previously found update when a later request fails.
2. **Keep the update route available before sign-in.** Checks start even when signed out, but the notice currently appears only in the signed-in shell and Settings. Put update access on the sign-in screen and/or in the native app menu so a Wilma login regression does not prevent installing its fix. The tray's Check Wilma now action currently checks school data, not app releases.
3. **Use Tauri's supported updater for download, signature verification and installation.** Replace the loose version comparison with its SemVer handling. Keep an explicit Update / Later choice, download progress, failure/retry feedback and an Install and restart action.
4. **Make a repeatable signed release.** Pin the runtime assets; build and sign on the local MacBook; sign the app and bundled native runtime with Developer ID; notarize and staple the release; create the DMG and updater archive/signature. The local release command runs desktop typechecks and frontend/native tests; CI is deferred.

## Recommended distribution route

Use the existing Cloudflare website for the download page and one small stable HTTPS feed. Store versioned binaries in GitHub Releases, separately from CLI and Claude Desktop releases. No update service with user accounts or school data is necessary.

The flow is:

`local signed Home build → versioned GitHub assets → /app/latest.json → app notice → user installs → app restarts`

- First target: **Apple Silicon macOS**, with the feed's platform entry `darwin-aarch64`. Windows and Linux come later, as more entries in the same feed. The 16 GB Mini local-model run remains pending; the 48 GB MacBook run is the current evidence.
- Website download: a signed/notarized DMG, with version, requirements and release notes at `/app` and a stable download link such as `/get/home`.
- Update artifact: Tauri's `.app.tar.gz` plus its `.sig`, referencing an immutable, version-specific GitHub asset URL.
- Feed: serve valid JSON directly with HTTP 200 at `/app/latest.json`, with short cache lifetime or revalidation. Include `version`, notes/date and the platform's archive URL/signature. Keep a top-level `url` pointing to the download page for the current manual checker if compatibility is needed. The current native HTTP client refuses redirects, so redirecting its feed to GitHub will not work.
- Keep the Home feed independent of GitHub's general `releases/latest`: this repository also publishes client, CLI and extension releases.
- Back up the Tauri updater signing key securely before distributing the first updater-enabled build. Embed only its public key in the app. This is separate from Apple's signing certificate. Do not store private keys in the repository or print them in CI logs.
- Create draft releases for review. Upload and verify the immutable assets before promoting the stable feed and website download. A normal source push must not advertise an unfinished Home release.
- Withdraw a faulty offer by reverting the feed to the last good release, then ship a fixed version with a higher version number. Default updater version checks do not downgrade already updated installations.

## Required upgrade rehearsal

Before the public download is enabled, use a private staging feed and two successive updater-enabled builds to prove:

- older build discovers the newer build automatically and through Check now;
- update is accessible while signed out and when the main window is hidden;
- download progress, Later, offline retry and invalid-signature rejection work;
- install/relaunch reaches the new version and failed downloads leave the old app usable;
- accounts, cached messages, drafts, API key, budget and chosen AI provider survive;
- local workers stop safely for restart, and the model pack remains outside the app bundle without another 9.1 GB download;
- the supported production package opens after a browser download with normal macOS protections enabled.

The release gate is a demonstrated upgrade between two builds, not just a successful build or a fabricated update notice. Preserve `ai.wilm.home` as the application identifier and the existing application-data locations.

## References

- [Tauri updater configuration, signed artifacts and feed format](https://v2.tauri.app/plugin/updater/)
- [Tauri macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri GitHub release pipeline](https://v2.tauri.app/distribute/pipelines/github/)

Remaining release work is Apple Developer credentials, updater signing-key custody, a demonstrated two-build signed upgrade and platform installer validation. Local release tooling is prepared; CI/release pipelines are deferred. The live site/feed is unchanged and no release was created.
