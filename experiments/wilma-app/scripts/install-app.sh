#!/bin/sh
# Build WilmAI Home from this checkout and install it in /Applications,
# replacing the previous build. Run it again to update (quits the app first
# and reopens it if it was running). The build is signed ad hoc, not with a
# Developer ID: open it the first time with right-click > Open.
set -e
cd "$(dirname "$0")/.."
NAME="WilmAI Home"
# Optional: with a code-signing certificate named "WilmAI Home Local" in the
# login keychain (Keychain Access > Certificate Assistant > Create a
# Certificate…, Identity Type "Self Signed Root", Certificate Type "Code
# Signing"), every build keeps one signature, so macOS remembers "Always
# Allow" for the Jev key across updates. Without it, builds are signed ad hoc.
if security find-certificate -c "$NAME Local" >/dev/null 2>&1; then
  export APPLE_SIGNING_IDENTITY="$NAME Local"
fi
# On a Mac the build includes local AI (src-tauri/tauri.macos.conf.json),
# which needs Apple Silicon.
pnpm tauri build --bundles app
BUILT="src-tauri/target/release/bundle/macos/$NAME.app"
DEST="/Applications/$NAME.app"
[ -w /Applications ] || DEST="$HOME/Applications/$NAME.app"
WAS_RUNNING=$(osascript -e "application \"$NAME\" is running" 2>/dev/null || echo false)
if [ "$WAS_RUNNING" = "true" ]; then
  osascript -e "tell application \"$NAME\" to quit"
  sleep 1
fi
rm -rf "$DEST"
ditto "$BUILT" "$DEST"
echo "Installed $DEST"
if [ "$WAS_RUNNING" = "true" ]; then open "$DEST"; fi
