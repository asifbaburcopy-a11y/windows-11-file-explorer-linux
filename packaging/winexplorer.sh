#!/bin/sh
# winexplorer — launcher for the Electron-based Explorer clone.
# On systems where unprivileged user namespaces are blocked (Ubuntu 23.04+
# AppArmor restriction), fall back to the SUID chrome-sandbox helper or, as
# a last resort, --no-sandbox, mirroring what Chrome/VS Code launchers do.
set -e

APP_DIR=/opt/winexplorer
ELECTRON="$APP_DIR/electron/electron"

if [ ! -x "$ELECTRON" ]; then
    echo "winexplorer: runtime not found at $ELECTRON" >&2
    exit 1
fi

# If the SUID helper is installed (normal .deb install), keep the sandbox.
SUID_OK=0
if [ -u "$APP_DIR/electron/chrome-sandbox" ]; then
    SUID_OK=1
fi

# Detect kernels that block unprivileged userns creation.
USERNS_OK=1
if [ -r /proc/sys/kernel/unprivileged_userns_clone ]; then
    if [ "$(cat /proc/sys/kernel/unprivileged_userns_clone)" = "0" ]; then
        USERNS_OK=0
    fi
fi

if [ "$SUID_OK" = "1" ] || [ "$USERNS_OK" = "1" ]; then
    exec "$ELECTRON" "$APP_DIR/resources/app" "$@"
fi

exec "$ELECTRON" --no-sandbox "$APP_DIR/resources/app" "$@"
