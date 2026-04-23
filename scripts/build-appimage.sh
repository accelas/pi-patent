#!/usr/bin/env bash
set -euo pipefail

APP_DIR="AppDir"
APP_NAME="pi-patent"
ARCH="x86_64"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/usr/bin"
mkdir -p "$APP_DIR/usr/share/$APP_NAME"

cp "dist/$APP_NAME"  "$APP_DIR/usr/bin/$APP_NAME"
cp -r src/prompts    "$APP_DIR/usr/share/$APP_NAME/prompts"
cp assets/icon.png   "$APP_DIR/$APP_NAME.png"

cat > "$APP_DIR/$APP_NAME.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=pi-patent
Exec=pi-patent
Icon=pi-patent
Terminal=true
Categories=Development;Utility;
EOF

cat > "$APP_DIR/AppRun" <<'EOF'
#!/usr/bin/env bash
APPDIR="$(dirname "$(readlink -f "$0")")"
export PI_PATENT_PROMPTS_DIR="${APPDIR}/usr/share/pi-patent/prompts"
exec "${APPDIR}/usr/bin/pi-patent" "$@"
EOF
chmod +x "$APP_DIR/AppRun"

APPIMAGETOOL="./appimagetool-${ARCH}.AppImage"
if [[ ! -x "$APPIMAGETOOL" ]]; then
  curl -fsSL -o "$APPIMAGETOOL" \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-${ARCH}.AppImage"
  chmod +x "$APPIMAGETOOL"
fi

"$APPIMAGETOOL" --appimage-extract-and-run "$APP_DIR" "${APP_NAME}-${ARCH}.AppImage"
echo "✓ Built ${APP_NAME}-${ARCH}.AppImage ($(du -h "${APP_NAME}-${ARCH}.AppImage" | cut -f1))"
