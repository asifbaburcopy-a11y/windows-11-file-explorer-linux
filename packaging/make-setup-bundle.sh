#!/bin/bash
# make-setup-bundle.sh — builds the downloadable "Explorer Setup" bundle:
#   dist/explorer-setup.tar.gz
# containing the .deb + the Windows-style setup wizard + license + readme.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
DEB="winexplorer_${VERSION}_amd64.deb"
BUNDLE="$ROOT/build/explorer-setup"

[ -f "$ROOT/dist/$DEB" ] || { echo "Build the deb first: npm run build:deb" >&2; exit 1; }

echo "==> Assembling setup bundle"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE"
cp "$ROOT/dist/$DEB" "$BUNDLE/"
cp "$ROOT/packaging/setup-wizard.sh" "$BUNDLE/"
chmod 755 "$BUNDLE/setup-wizard.sh"
cp "$ROOT/packaging/LICENSE" "$BUNDLE/"
cp "$ROOT/app/assets/icon-256.png" "$BUNDLE/winexplorer.png"
cat > "$BUNDLE/README.txt" <<EOF
Explorer ${VERSION} for Linux — Setup
=====================================

Double-click (or run) the setup wizard:

    ./setup-wizard.sh

It walks you through Welcome → License Agreement → Installation, then asks
whether to make Explorer your default file manager and whether to launch it.

Prerequisite: a Debian/Ubuntu family system with dpkg, zenity or yad, and
polkit (all present on default desktop installs).

Manual alternative:

    sudo dpkg -i winexplorer_${DEB#winexplorer_}

Uninstall:

    sudo apt remove winexplorer
EOF

echo "==> Creating dist/explorer-setup.tar.gz"
tar -C "$ROOT/build" -czf "$ROOT/dist/explorer-setup.tar.gz" explorer-setup
ls -la "$ROOT/dist/"
echo "==> Bundle ready: dist/explorer-setup.tar.gz"
