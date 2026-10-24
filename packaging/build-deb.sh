#!/bin/bash
# build-deb.sh — assembles the Debian package for Explorer.
# Produces: dist/winexplorer_<version>_amd64.deb
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ARCH=amd64
NAME="winexplorer_${VERSION}_${ARCH}.deb"
STAGE="$ROOT/build/debian"
ELECTRON_DIR="$ROOT/node_modules/electron/dist"

if [ ! -x "$ELECTRON_DIR/electron" ]; then
    echo "Electron runtime missing — run: npm install" >&2
    exit 1
fi

command -v dpkg-deb >/dev/null || { echo "dpkg-deb not found" >&2; exit 1; }

echo "==> Staging package tree"
rm -rf "$STAGE"
mkdir -p "$STAGE/DEBIAN" \
         "$STAGE/opt/winexplorer/electron" \
         "$STAGE/opt/winexplorer/resources/app" \
         "$STAGE/usr/bin" \
         "$STAGE/usr/share/applications" \
         "$STAGE/usr/share/doc/winexplorer" \
         "$STAGE/usr/share/icons/hicolor/16x16/apps" \
         "$STAGE/usr/share/icons/hicolor/32x32/apps" \
         "$STAGE/usr/share/icons/hicolor/48x48/apps" \
         "$STAGE/usr/share/icons/hicolor/64x64/apps" \
         "$STAGE/usr/share/icons/hicolor/128x128/apps" \
         "$STAGE/usr/share/icons/hicolor/256x256/apps" \
         "$STAGE/usr/share/icons/hicolor/scalable/apps" \
         "$STAGE/var/lib/winexplorer" \
         "$STAGE/usr/share/debconf/templates.d"

echo "==> Copying Electron runtime (this is the big one)"
cp -r "$ELECTRON_DIR/." "$STAGE/opt/winexplorer/electron/"
# Drop unneeded bulk to keep the package lean (locales are needed by
# Chromium, so they stay; the chromium_helper crashpad bits stay too).
rm -f "$STAGE/opt/winexplorer/electron/resources/default_app.asar.bak" 2>/dev/null || true

echo "==> Copying application sources"
cp -r "$ROOT/app/." "$STAGE/opt/winexplorer/resources/app/"
rm -f "$STAGE/opt/winexplorer/resources/app/package.json.orig" 2>/dev/null || true
# Strip dev-only files from the shipped app dir.
find "$STAGE/opt/winexplorer/resources/app" -name '*.map' -delete 2>/dev/null || true

# Electron resolves the app by reading this package.json's "main".
cat > "$STAGE/opt/winexplorer/resources/app/package.json" <<EOF
{
  "name": "winexplorer",
  "productName": "Explorer",
  "version": "$VERSION",
  "description": "Windows 11 style file manager",
  "main": "main.js",
  "license": "MIT"
}
EOF

echo "==> Installing launcher, desktop entry, icons, docs"
install -m 755 "$ROOT/packaging/winexplorer.sh" "$STAGE/usr/bin/winexplorer"
install -m 644 "$ROOT/packaging/winexplorer.desktop" "$STAGE/usr/share/applications/winexplorer.desktop"
install -m 644 "$ROOT/packaging/templates" "$STAGE/usr/share/debconf/templates.d/winexplorer"
install -m 644 "$ROOT/README.md" "$STAGE/usr/share/doc/winexplorer/README.md" 2>/dev/null || true

for size in 16 32 48 64 128 256; do
    src="$ROOT/app/assets/icon-${size}.png"
    [ -f "$src" ] && install -m 644 "$src" "$STAGE/usr/share/icons/hicolor/${size}x${size}/apps/winexplorer.png"
done
install -m 644 "$ROOT/app/assets/icon-256.png" "$STAGE/usr/share/icons/hicolor/scalable/apps/winexplorer.png" 2>/dev/null || true

echo "==> Validating desktop entry"
if command -v desktop-file-validate >/dev/null 2>&1; then
    desktop-file-validate "$STAGE/usr/share/applications/winexplorer.desktop" || {
        echo "WARNING: desktop-file-validate reported issues (see above)"
    }
else
    echo "    (desktop-file-validate not installed — skipped)"
fi

echo "==> Writing DEBIAN/control"
SIZE_KB=$(du -sk "$STAGE" | cut -f1)
INSTALLED_SIZE=$((SIZE_KB * 1024 / 1024))
cat > "$STAGE/DEBIAN/control" <<EOF
Package: winexplorer
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Depends: hicolor-icon-theme, libgtk-3-0 | libgtk-4-0, libnss3, libasound2 | libasound2t64, xdg-utils, desktop-file-utils
Recommends: zenity | yad, udisks2, gvfs-backends
Suggests: gnome-terminal | konsole | xfce4-terminal | kitty
Installed-Size: $INSTALLED_SIZE
Maintainer: Explorer Project <explorer@example.com>
Homepage: https://github.com/morluto/rea
Description: Windows 11 style file manager for Linux
 A file manager that recreates the look, feel and workflow of the
 Windows 11 File Explorer on Debian-based Linux distributions: tabbed
 browsing, breadcrumb address bar, command bar, navigation pane with
 Home / Gallery / This PC / Network, eight view modes, a real
 FreeDesktop.org Recycle Bin, drive capacity overview and Windows-style
 installation with a default-file-manager prompt.
 .
 The package installs the Electron runtime under /opt/winexplorer and
 registers "winexplorer.desktop" as a file manager handler for
 inode/directory.
EOF

echo "==> Installing maintainer scripts"
install -m 755 "$ROOT/packaging/config" "$STAGE/DEBIAN/config"
install -m 755 "$ROOT/packaging/postinst" "$STAGE/DEBIAN/postinst"
install -m 755 "$ROOT/packaging/prerm" "$STAGE/DEBIAN/prerm"
install -m 755 "$ROOT/packaging/postrm" "$STAGE/DEBIAN/postrm"
# dpkg requires maintainer scripts to be owned by root; --root-owner-group
# on the build takes care of the archive metadata.
sed -i '/^#DEBHELPER#$/d' "$STAGE/DEBIAN/config" "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm" "$STAGE/DEBIAN/postrm"
# Syntax-check every maintainer script before building.
for s in config postinst prerm postrm; do sh -n "$STAGE/DEBIAN/$s" || { echo "syntax error in $s" >&2; exit 1; }; done

echo "==> Building $NAME"
mkdir -p "$ROOT/dist"
dpkg-deb --build --root-owner-group -Zxz "$STAGE" "$ROOT/dist/$NAME"

echo "==> Done: dist/$NAME"
dpkg-deb --info "$ROOT/dist/$NAME"
