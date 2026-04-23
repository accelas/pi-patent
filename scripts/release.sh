#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Clean"
npm run clean

echo "→ Check (biome + tsc)"
npm run check

echo "→ Test"
npm test

echo "→ Build AppImage"
npm run build:appimage

echo "✓ Release build complete: $(ls pi-patent-*.AppImage)"
