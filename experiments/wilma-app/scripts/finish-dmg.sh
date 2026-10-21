#!/bin/sh
# Finishes WilmAI Home's Mac DMG as Tauri builds it: the background (desktop-assets/dmg), a link to System Settings'
# Privacy & Security (where Open Anyway appears the first time), the hidden files kept hidden, and the window's layout.
# Usage: sh scripts/finish-dmg.sh "<Tauri's .dmg>" <out.dmg>
# Finder lays the window out, so this runs on a Mac with Finder; it ejects a mounted "WilmAI Home" first.
set -e
SRC="$1"; OUT="$2"
[ -f "$SRC" ] && [ -n "$OUT" ] || { echo 'Usage: sh scripts/finish-dmg.sh "<Tauri .dmg>" <out.dmg>'; exit 1; }
HERE=$(cd "$(dirname "$0")/.." && pwd)
VOL="/Volumes/WilmAI Home"
[ -d "$VOL" ] && hdiutil detach "$VOL" >/dev/null
W=$(mktemp -d)
hdiutil convert "$SRC" -format UDRW -o $W/rw.dmg >/dev/null
hdiutil resize -size $(( $(stat -f%z $W/rw.dmg) / 1048576 + 8 ))m $W/rw.dmg >/dev/null
hdiutil attach $W/rw.dmg >/dev/null
sleep 1
cp "$VOL/.VolumeIcon.icns" $W/VolumeIcon.icns
rm -f "$VOL/.background/"*
mkdir -p "$VOL/.background"
cp "$HERE/desktop-assets/dmg/background.tiff" "$VOL/.background/background.tiff"
# Finder won't open a .webloc to System Settings; the old pane file still opens Privacy & Security, like the Applications link.
ln -s /System/Library/PreferencePanes/Security.prefPane "$VOL/Privacy & Security"
chflags hidden "$VOL/.background" "$VOL/.VolumeIcon.icns"
osascript <<'APPLESCRIPT'
tell application "Finder"
  tell disk "WilmAI Home"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 100, 860, 688}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 112
    set text size of opts to 13
    set background picture of opts to file ".background:background.tiff"
    set position of item "WilmAI Home.app" of container window to {170, 165}
    set position of item "Applications" of container window to {490, 165}
    set position of item "Privacy & Security" of container window to {545, 420}
    try
      set position of item ".background" of container window to {760, 720}
    end try
    close
    open
    update without registering applications
    delay 2
    close
  end tell
end tell
APPLESCRIPT
sleep 2
# Finder drops the volume icon file while it writes the layout: put it back, as the volume's custom icon, hidden.
cp $W/VolumeIcon.icns "$VOL/.VolumeIcon.icns"
SetFile -c icnC "$VOL/.VolumeIcon.icns"
SetFile -a V "$VOL/.VolumeIcon.icns"
chflags hidden "$VOL/.VolumeIcon.icns"
SetFile -a C "$VOL"
rm -rf "$VOL/.fseventsd"
sync
hdiutil detach "$VOL" >/dev/null
rm -f $W/final.dmg
hdiutil convert $W/rw.dmg -format UDZO -imagekey zlib-level=9 -o $W/final.dmg >/dev/null
cp $W/final.dmg "$OUT"
rm -rf $W
M=$(mktemp -d) && hdiutil attach -nobrowse -readonly -mountpoint $M "$OUT" >/dev/null && codesign --verify --deep --strict "$M/WilmAI Home.app" && echo "app signature valid; settings link -> $(readlink "$M/Privacy & Security")"; hdiutil detach $M >/dev/null; rmdir $M
echo done
