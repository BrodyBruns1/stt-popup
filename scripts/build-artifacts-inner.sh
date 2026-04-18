#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${DIST_DIR:-$REPO_ROOT/dist}"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-/opt/stt-popup-dist}"

cd "$REPO_ROOT"

if [ ! -d node_modules ]; then
npm ci
fi

rm -f "$DIST_DIR/STT-Popup-Windows.zip"

npm run build:linux
set +e
npx electron-builder --win dir
WIN_BUILD_EXIT=$?
set -e

if [ "$WIN_BUILD_EXIT" -ne 0 ] && [ ! -d "$DIST_DIR/win-unpacked" ]; then
  exit "$WIN_BUILD_EXIT"
fi

python3 - <<PY
from pathlib import Path
import zipfile

dist_dir = Path(r"$DIST_DIR")
source_dir = dist_dir / "win-unpacked"
zip_path = dist_dir / "STT-Popup-Windows.zip"

if not source_dir.exists():
    raise SystemExit("win-unpacked was not produced")

install_bat = Path(r"/scripts/install.bat")

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(source_dir.rglob("*")):
        archive.write(path, path.relative_to(source_dir))
    if install_bat.exists():
        archive.write(install_bat, "install.bat")
    else:
        print(f"Warning: {install_bat} not found, skipping")
PY

mkdir -p "$ARTIFACTS_DIR"
cp "$DIST_DIR/STT-Popup-Windows.zip" "$ARTIFACTS_DIR/STT-Popup-Windows.zip"

APPIMAGE_PATH="$(find "$DIST_DIR" -maxdepth 1 -type f -name '*.AppImage' | head -n 1 || true)"
if [ -n "$APPIMAGE_PATH" ]; then
  cp "$APPIMAGE_PATH" "$ARTIFACTS_DIR/STT-Popup.AppImage"
fi

MAC_ARTIFACT="$(find "$DIST_DIR" -maxdepth 1 -type f \( -name '*.dmg' -o -name '*mac*.zip' -o -name '*darwin*.zip' \) | head -n 1 || true)"
if [ -n "$MAC_ARTIFACT" ]; then
  extension="${MAC_ARTIFACT##*.}"
  cp "$MAC_ARTIFACT" "$ARTIFACTS_DIR/STT-Popup-macOS.${extension}"
elif [ "$(uname -s)" != "Darwin" ]; then
  echo "Skipping macOS build: this VM can stage macOS artifacts if provided, but building them still requires a macOS builder."
fi

ls -lah "$ARTIFACTS_DIR"
