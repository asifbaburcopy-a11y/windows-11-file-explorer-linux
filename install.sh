#!/usr/bin/env bash
#
# Explorer for Linux — one-command installer.
#
# Builds the Debian package from source, runs the test suite and installs
# it system-wide. Tested on Ubuntu, Linux Mint, Pop!_OS, Debian and Zorin OS.
#
# Usage:
#   ./install.sh              build + test + install (asks for sudo once)
#   ./install.sh --build-only build and test, skip the sudo install
#
set -euo pipefail

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")"

# --- prerequisites ---------------------------------------------------------
# Fall back to common user-local Node installs (manual tarball, nvm) when
# the current shell does not have it on PATH.
if ! command -v node >/dev/null 2>&1; then
  for _d in "$HOME"/.local/opt/node*/bin "$HOME"/.nvm/versions/node/*/bin /usr/local/node*/bin; do
    if [ -x "$_d/node" ]; then PATH="$_d:$PATH"; export PATH; break; fi
  done
fi
command -v node >/dev/null 2>&1 || fail "Node.js is required: sudo apt install nodejs npm"
command -v npm  >/dev/null 2>&1 || fail "npm is required: sudo apt install npm"
command -v dpkg >/dev/null 2>&1 || fail "dpkg not found — this installer targets Debian-based systems"

# --- dependencies (Electron runtime, one time) -----------------------------
if [ ! -x node_modules/.bin/electron ]; then
  say "Installing dependencies (Electron runtime, ~110 MB, one time)"
  npm install
fi

# --- tests -----------------------------------------------------------------
say "Running the test suite"
npm test

# --- build -----------------------------------------------------------------
say "Building the Debian package"
bash packaging/build-deb.sh

DEB="$(ls dist/winexplorer_*_amd64.deb | tail -1)"
[ -n "$DEB" ] || fail "build produced no .deb in dist/"

if [ "${1:-}" = "--build-only" ]; then
  say "Build complete: $DEB (skipped install as requested)"
  exit 0
fi

# --- install ---------------------------------------------------------------
say "Installing system-wide (your sudo password is required once)"
if ! sudo dpkg -i "$DEB"; then
  say "Fixing dependencies"
  sudo apt-get -f install -y
fi

say "Installed. Launch 'Explorer' from your app menu, or run: winexplorer"
say "Tip: answer 'Set as default' on first launch to open folders with Explorer."
