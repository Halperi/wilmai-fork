# iOS preview

This fork uses the existing Tauri 2 app on iOS. The React views, data engine,
AI prompts and `packages/wilma-client` stay shared with upstream. There is no
second mobile UI to keep in sync. Android has platform detection and command
gating, but has not been generated or built in this change.

## Primary phone target

The owner's phone is **iPhone 15 with iOS 27.2**. Use that simulator as the
primary UI check (393 × 852 points in portrait, including Dynamic Island and
home-indicator insets). Keep layouts responsive so the same shared UI works
on other phones too. Simulator layout checks do not establish performance,
battery usage or keyboard behavior on the physical A16 device.

Create an iPhone 15 simulator with iOS 27.2 in Xcode's Device Hub if it is missing,
then run `pnpm ios:dev:iphone15`. `pnpm ios:dev` keeps the generic device picker.
Check portrait and landscape, readable tab labels, horizontal tab scrolling,
message reading and the home-indicator/keyboard area. The phone navigation keeps
its tap targets at least 48 points high; overflowing tabs scroll horizontally.

## Build on a Mac

Install full Xcode, launch it once, accept its license and install an iOS
simulator runtime. Rust needs the simulator target; add the device target when
building for your iPhone. Follow the same pnpm version as the repository.

```sh
# Repository root
pnpm install --frozen-lockfile
cd apps/home
pnpm install --ignore-workspace --frozen-lockfile
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export PATH="$DEVELOPER_DIR/usr/bin:$PATH"
rustup target add aarch64-apple-ios-sim aarch64-apple-ios
brew install xcodegen libimobiledevice cocoapods
pnpm ios:init --ci
pnpm ios:build --ci
```

`ios:init` generates the ignored Xcode project in `src-tauri/gen/apple`.
`ios:build` packages the UI and Rust library into an unsigned debug application
for an Apple Silicon simulator. No Apple Developer membership or signing team
is needed for the simulator. Run `pnpm ios:dev` for an interactive simulator
build, or `pnpm ios:dev --open` to open the generated project in Xcode.

The iOS configuration is `src-tauri/tauri.ios.conf.json`, merged automatically
by Tauri. Its bundle ID is `fi.halperi.wilmai.home`, separate from the upstream
desktop app. Minimum deployment version: iOS 16.0. The Vite development server
uses `TAURI_DEV_HOST` when Tauri supplies it for a physical device.

## Test on your own iPhone

In Xcode Settings → Accounts, sign in with your own Apple Account. Connect and
trust your iPhone, enable Developer Mode on the phone, then select your Personal
Team under the generated app target's Signing & Capabilities. Choose your phone
as the run destination and build from Xcode. Tauri also accepts the team ID via
`APPLE_DEVELOPMENT_TEAM`; do not commit account credentials or provisioning files.
A free Personal Team build needs periodic reprovisioning. A simulator `.app`
cannot be installed on a physical phone: build the device target separately.

## What the prototype changes

- Mobile uses the existing Rust HTTP commands. Wilma cookies and redirects stay
  under the shared client/engine; browser CORS restrictions do not apply.
- Mobile does not read desktop CLI accounts, the old Mac Keychain entry, or the
  shared CLI session file. Existing upstream multi-account logic stays shared.
- Desktop tray, window hiding, local AI runtimes and desktop installers are
  excluded from mobile. HTTPS links open through the native opener plugin.
- The viewport uses safe-area insets and the dynamic viewport height. Mobile
  inputs use at least 16px text to avoid iOS focus zoom.
- Periodic refresh runs in the foreground. Hiding the app requests a persistence
  flush; iOS can still suspend or terminate a process without a final callback.

## Limits before daily use

Start with **the sample family**. This change does not implement an iOS Keychain
store: the upstream app still persists credentials and optional API keys in its
existing browser storage format. Base64 is not encryption. Move secrets and
session material to an account-scoped native secure store before treating this
as a finished phone app. Do not export real school data into CI or screenshots.

There are no background refresh guarantees, APNs push notifications, camera or
attachment picker integration, mobile update delivery, or local AI in this
prototype. Do not infer live Wilma login or message-send coverage from the demo
or the offline tests. Wilma may invalidate another device's session when the
same account logs in again; there is no cross-device session sharing here.

## Keep upstream updates easy

Merge upstream into this fork regularly. Keep mobile-specific behavior in
`src/platform.ts`, native command gates, the iOS config and small style overrides.
Add new business behavior to the existing shared engine and views. When upstream
adds a native command or OS integration, explicitly decide which platforms get
it; do not equate `isNativeApp` with `isDesktopApp`.

Run `pnpm typecheck`, `TZ=UTC pnpm test:mobile` and the Home regression tests.
The `home-ios` workflow builds the simulator app for relevant pull requests and
manual runs. Tauri init preserves existing generated files. After native dependency/configuration
changes, move the generated directory aside and generate it again; first preserve
any local signing or native project changes. Keep those settings in configuration
when possible. Keep generated Xcode files and signing material out of Git.

## Verified locally (2026-11-01)

Built the unsigned arm64 simulator `.app` with Xcode 27.2 / iOS 27.2 and
installed/launched it on an iPhone 18 Pro simulator. The sample family, message list and message reader render in the native app; sample data survives a process restart.
TypeScript passes; the Home offline suite has 103 passes and one skipped test;
the desktop Rust library suite has 14 passes and one ignored test. The new mobile
transport/platform subset has five passing tests. No physical iPhone, live Wilma
account, real message send or background notification has been tested.
