#!/bin/bash
# setup-wizard.sh — a Windows-Setup-style graphical installer for Explorer.
# Walks through Welcome → Agreement → Install (progress) → Finish, where the
# Finish screen offers "set as default file manager" and "launch now"
# checkboxes — exactly like a classic Windows setup program.
#
# GUI: yad or zenity (polkit elevation for the copy step); plain terminal
# walkthrough as a fallback.
set -euo pipefail

VERSION="${WX_VERSION:-1.0.0}"
DEB_NAME="winexplorer_${VERSION}_amd64.deb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEB_PATH="$HERE/$DEB_NAME"
LOG_FILE="$(mktemp)"
STATUS_FILE="$LOG_FILE.exit"
ICON="$HERE/winexplorer.png"
[ -f "$ICON" ] || ICON="folder"

GUI=""
if command -v yad >/dev/null 2>&1; then GUI=yad
elif command -v zenity >/dev/null 2>&1; then GUI=zenity
elif [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then GUI=terminal
fi

# --------------------------------------------------------- install step
# Runs dpkg under pkexec while a pulsate progress window stays alive until
# dpkg exits; returns 0 on success.
install_package() {
    rm -f "$STATUS_FILE"
    ( pkexec dpkg -i "$DEB_PATH" >"$LOG_FILE" 2>&1; echo $? >"$STATUS_FILE" ) &
    local dpkg_pid=$!

    if [ "$GUI" = "yad" ]; then
        coproc PROGRESS { yad --progress --pulsate --title="Explorer Setup" \
            --window-icon="$ICON" --text="Installing Explorer ${VERSION}..." \
            --auto-close --no-cancel 2>/dev/null; }
        while [ ! -f "$STATUS_FILE" ]; do
            printf 'P:50\n' >&"${PROGRESS[1]}" 2>/dev/null || break
            sleep 0.3
        done
        printf 'P:100\n' >&"${PROGRESS[1]}" 2>/dev/null || true
    elif [ "$GUI" = "zenity" ]; then
        (
            while [ ! -f "$STATUS_FILE" ]; do echo "50"; sleep 0.3; done
            echo "100"
        ) | zenity --progress --pulsate --title="Explorer Setup" \
            --text="Installing Explorer ${VERSION}..." \
            --auto-close --no-cancel 2>/dev/null || true
    fi

    wait "$dpkg_pid" 2>/dev/null || true
    local rc
    rc=$(cat "$STATUS_FILE" 2>/dev/null || echo 1)
    [ "$rc" = "0" ] || return 1
    dpkg -s winexplorer >/dev/null 2>&1
}

# ------------------------------------------------------------ finish step
finish_notes() {
    local default_state="$1" launch_now="$2"
    if [ "$default_state" = "true" ]; then
        xdg-mime default winexplorer.desktop inode/directory 2>/dev/null || true
    fi
    if [ "$launch_now" = "true" ] && command -v winexplorer >/dev/null 2>&1; then
        nohup winexplorer >/dev/null 2>&1 &
    fi
    exit 0
}

fail_install() {
    local msg
    msg=$(tail -c 1200 "$LOG_FILE" 2>/dev/null || echo "unknown error")
    if [ "$GUI" = "yad" ] || [ "$GUI" = "zenity" ]; then
        if [ "$GUI" = "yad" ]; then
            yad --error --title="Explorer Setup" --text="Installation failed:\n\n$msg" 2>/dev/null || true
        else
            zenity --error --title="Explorer Setup" --width=520 \
                --text="Installation failed:\n\n$msg" 2>/dev/null || true
        fi
    fi
    echo "Installation failed:" >&2
    echo "$msg" >&2
    exit 1
}

# ------------------------------------------------------------- GUI wizard
run_gui() {
    local out rc agree=false

    # -------------------------------------------------------- Welcome
    if [ "$GUI" = "yad" ]; then
        yad --title="Explorer Setup" --window-icon="$ICON" --width=540 --center \
            --text="<b><span size='xx-large'>Explorer Setup</span></b>\n\nThis wizard will install Explorer ${VERSION} on your computer.\n\nClick <b>Next</b> to continue, or <b>Cancel</b> to exit Setup." \
            --button="Cancel:1" --button="Next:0" 2>/dev/null || exit 1
    else
        zenity --info --title="Explorer Setup" --width=480 \
            --ok-label="Next" \
            --text="<b>Explorer Setup</b>\n\nThis wizard will install Explorer ${VERSION} on your computer.\n\nClick Next to continue." 2>/dev/null || exit 1
    fi

    # ------------------------------------------------------ Agreement
    if [ "$GUI" = "yad" ]; then
        rc=0
        yad --title="Explorer Setup — License Agreement" --window-icon="$ICON" \
            --width=600 --height=520 --center \
            --text="Please review the license agreement before continuing." \
            --text-info --filename="$HERE/LICENSE" --wrap \
            --button="Back:2" --button="Cancel:1" --button="I &Accept:0" 2>/dev/null || rc=$?
        [ "$rc" = "2" ] && exec "$0"
        [ "$rc" = "0" ] || exit 1
    else
        zenity --text-info --title="Explorer Setup — License Agreement" \
            --width=640 --height=460 --filename="$HERE/LICENSE" 2>/dev/null || exit 1
        zenity --question --title="Explorer Setup" --width=440 \
            --ok-label="I Accept" --cancel-label="Cancel" \
            --text="Do you accept the license agreement?" 2>/dev/null || exit 1
    fi

    # ----------------------------------------------------- Installing
    install_package || fail_install

    # ---------------------------------------------------- Finish screen
    if [ "$GUI" = "yad" ]; then
        out=$(yad --title="Explorer Setup — Completing" --window-icon="$ICON" \
            --width=540 --center \
            --text="<b><span size='xx-large'>Completing Explorer Setup</span></b>\n\nExplorer ${VERSION} has been installed successfully." \
            --form \
            --field="Set Explorer as my default file manager:CHK" TRUE \
            --field="Launch Explorer now:CHK" TRUE \
            --button="Finish:0" 2>/dev/null) || out="TRUE|TRUE|"
        local default_state launch_now
        default_state=$(printf '%s' "$out" | cut -d'|' -f1)
        launch_now=$(printf '%s' "$out" | cut -d'|' -f2)
        [ "$default_state" = "TRUE" ] && default_state=true || default_state=false
        [ "$launch_now" = "TRUE" ] && launch_now=true || launch_now=false
    else
        zenity --info --title="Explorer Setup" --width=440 \
            --text="Explorer ${VERSION} has been installed successfully." 2>/dev/null || true
        local default_state=false launch_now=true
        if zenity --question --title="Explorer Setup" --width=460 \
            --text="Set Explorer as your default file manager?\n\nFolders you open from the desktop and other apps will open in Explorer." \
            --ok-label="Yes" --cancel-label="Not now" 2>/dev/null; then
            default_state=true
        fi
        if zenity --question --title="Explorer Setup" --width=440 \
            --text="Launch Explorer now?" --ok-label="Yes" --cancel-label="No" 2>/dev/null; then
            launch_now=true
        else
            launch_now=false
        fi
    fi
    finish_notes "$default_state" "$launch_now"
}

# -------------------------------------------------------- terminal wizard
run_terminal() {
    echo "==================== Explorer Setup ===================="
    echo "  This wizard will install Explorer ${VERSION}."
    echo "  Press Enter to continue (Ctrl+C to cancel)."
    read -r _
    echo "--------------------------------------------------------"
    echo "License agreement: see the LICENSE file next to this script."
    echo "Press Enter to accept it."
    read -r _
    echo "Installing Explorer (administrator privileges required)..."
    if ! pkexec dpkg -i "$DEB_PATH"; then
        echo "Installation failed:" >&2
        tail -c 1200 "$LOG_FILE" >&2 || true
        exit 1
    fi
    echo
    local a b
    read -r -p "Set Explorer as your default file manager? [Y/n] " a
    case "${a:-y}" in
        [Yy]* | "") xdg-mime default winexplorer.desktop inode/directory 2>/dev/null || true ;;
    esac
    read -r -p "Launch Explorer now? [Y/n] " b
    case "${b:-y}" in
        [Yy]* | "") nohup winexplorer >/dev/null 2>&1 & ;;
    esac
    echo "Setup finished."
}

# ------------------------------------------------------------------ main
if [ ! -f "$DEB_PATH" ]; then
    echo "Cannot find $DEB_PATH next to this script." >&2
    exit 1
fi

if [ "$GUI" = "terminal" ]; then
    run_terminal
elif [ -n "$GUI" ]; then
    run_gui
else
    run_terminal
fi
