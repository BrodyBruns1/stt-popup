#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-/opt/stt-popup-dist}"
BUILDER_IMAGE="${BUILDER_IMAGE:-stt-popup-builder:local}"

cd "$REPO_ROOT"

if command -v npm >/dev/null 2>&1; then
  ARTIFACTS_DIR="$ARTIFACTS_DIR" bash "$REPO_ROOT/scripts/build-artifacts-inner.sh"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Neither npm nor docker is available for building artifacts." >&2
  exit 1
fi

docker build -t "$BUILDER_IMAGE" -f "$REPO_ROOT/Dockerfile.build" "$REPO_ROOT"
mkdir -p "$ARTIFACTS_DIR"

docker run --rm \
  -v "$REPO_ROOT:/build" \
  -v "$ARTIFACTS_DIR:/artifacts" \
  -w /build \
  -e ARTIFACTS_DIR=/artifacts \
  "$BUILDER_IMAGE" \
  bash ./scripts/build-artifacts-inner.sh

chown -R "$(id -u)":"$(id -g)" "$ARTIFACTS_DIR"
