#!/bin/sh
# Renders Studio Recorder's icon, menu-bar glyphs and wordmark from source/*.svg (rsvg-convert, iconutil).
# The SVGs are the source of truth; rerun this after editing one and commit what it writes.
# Glyph names ending in "Template" load as template images: macOS tints them for a light or dark menu bar.
set -eu
cd "$(dirname "$0")"
iconset=$(mktemp -d)/AppIcon.iconset
mkdir -p "$iconset" menu-bar
for size in 16 32 128 256 512; do
  rsvg-convert -w "$size" source/AppIcon.svg -o "$iconset/icon_${size}x${size}.png"
  rsvg-convert -w $((size * 2)) source/AppIcon.svg -o "$iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$iconset" -o AppIcon.icns
rsvg-convert -w 1024 source/AppIcon.svg -o AppIcon-1024.png
for glyph in MenuBarIdleTemplate MenuBarBusyTemplate MenuBarRecording MenuBarNeedsPermission; do
  rsvg-convert -f pdf source/$glyph.svg -o menu-bar/$glyph.pdf
  rsvg-convert -w 18 source/$glyph.svg -o menu-bar/$glyph.png
  rsvg-convert -w 36 source/$glyph.svg -o menu-bar/$glyph@2x.png
done
rsvg-convert -h 64 source/Wordmark.svg -o Wordmark.png
rsvg-convert -h 128 source/Wordmark.svg -o Wordmark@2x.png
