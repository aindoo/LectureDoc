#!/usr/bin/env bash
# Downloads static FFmpeg builds and places them in src-tauri/binaries/ with
# the target-triple suffix Tauri expects. Run once before `npm run tauri build`.
#
# Binaries from github.com/eugeneware/ffmpeg-static — native arm64 + x64,
# links only to macOS system frameworks (no Homebrew dependency).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  TRIPLE="aarch64-apple-darwin"
  PLATFORM="darwin-arm64"
else
  TRIPLE="x86_64-apple-darwin"
  PLATFORM="darwin-x64"
fi

BASE_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1"

download_bin() {
  local name="$1"
  local dest="$BINARIES_DIR/$name-$TRIPLE"
  if [ -f "$dest" ]; then
    echo "✓ $name already present"
    return
  fi
  echo "Downloading $name ($PLATFORM)..."
  curl -fsSL "$BASE_URL/$name-$PLATFORM" -o "$dest"
  chmod +x "$dest"
  echo "✓ $name → $dest"
}

download_bin "ffmpeg"
download_bin "ffprobe"

echo ""
echo "Done. Run: npm run tauri build"
