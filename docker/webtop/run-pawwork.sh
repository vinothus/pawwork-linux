#!/usr/bin/with-contenv bash
#
# Launches PawWork on the webtop desktop. Used by:
#   - /custom-services.d/pawwork  (auto-start at container boot, supervised)
#   - the PawWork .desktop entry  (manual launch from the app menu)
#
# Environment:
#   PAWWORK_DIR      where the built PawWork checkout lives (default /app/pawwork)
#   PAWWORK_RUN_MODE built = launch the electron-vite build (default)
#                    dev   = run `pnpm dev:desktop` (HMR dev server)
#   DISPLAY          X display to use (defaults to :1, the webtop Xvfb)
set -euo pipefail

# --- resolve the app location ------------------------------------------------
PAWWORK_DIR="${PAWWORK_DIR:-/app/pawwork}"
PAWWORK_RUN_MODE="${PAWWORK_RUN_MODE:-built}"

# The webtop images bake HOME=/config for the abc user. Resolve the real home
# of whatever uid this service runs under so app data lands in a stable place
# (root -> /root, abc/PUID 1000 -> /config).
export HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"
export HOME="${HOME:-/config}"
mkdir -p "${HOME}"

# --- wait for the X server ---------------------------------------------------
# X11 webtop mode (the default for ubuntu-xfce) runs Xvfb on DISPLAY=:1.
if [ -z "${DISPLAY:-}" ]; then
  export DISPLAY=":1"
fi
X_SOCKET="/tmp/.X11-unix/X${DISPLAY#:}"
X_WAS_UP=0
[ -S "${X_SOCKET}" ] && X_WAS_UP=1
for _ in $(seq 1 90); do
  [ -S "${X_SOCKET}" ] && break
  sleep 1
done
if [ ! -S "${X_SOCKET}" ]; then
  echo "[pawwork] X server not found on ${DISPLAY} after 90 s; aborting" >&2
  exit 1
fi
# If the desktop had to come up, give the window manager a head start so the
# PawWork window lands on a live desktop instead of a bare root window.
if [ "${X_WAS_UP}" != "1" ]; then sleep 5; fi

# --- app environment ---------------------------------------------------------
# Chromium's sandbox needs setuid helpers / user namespaces, which containers
# do not provide; --no-sandbox + ELECTRON_DISABLE_SANDBOX are required.
# Xvfb has no GPU: force software rendering.
export ELECTRON_DISABLE_SANDBOX=1
export NO_AT_BRIDGE=1
export LIBGL_ALWAYS_SOFTWARE=1
export ELECTRON_ENABLE_LOGGING=1

ELECTRON_ARGS=(--no-sandbox --disable-gpu)
# Wayland webtop mode (e.g. ubuntu-kde with PIXELFLUX_WAYLAND=true).
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  ELECTRON_ARGS+=(--ozone-platform=wayland)
fi

cd "${PAWWORK_DIR}"

echo "[pawwork] launching mode=${PAWWORK_RUN_MODE} display=${DISPLAY} home=${HOME} dir=${PAWWORK_DIR}"
case "${PAWWORK_RUN_MODE}" in
  dev)
    # HMR dev server. Needs write access to packages/desktop-electron/out, so
    # run in dev mode with the container user that owns the checkout (e.g.
    # PUID=0) or after `chown -R abc:abc /app/pawwork`.
    exec pnpm dev:desktop
    ;;
  *)
    exec pnpm --filter @pawwork/desktop exec electron . "${ELECTRON_ARGS[@]}"
    ;;
esac