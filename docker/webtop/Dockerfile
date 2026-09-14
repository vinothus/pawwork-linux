# syntax=docker/dockerfile:1
#
# PawWork inside a LinuxServer Webtop container — a full Linux desktop you can
# reach from any browser, with PawWork compiled from source and auto-launched
# on it, so the UI can be verified visually on Linux.
#
# Build (from the repository root):
#   docker build -f docker/webtop/Dockerfile -t pawwork-linux-test .
#   podman build -f docker/webtop/Dockerfile -t pawwork-linux-test .
#
# Run: see docker/webtop/README.md (docker compose or the plain run command).

# X11 flavor by default: Electron is most reliable on the Xvfb/X11 stack.
# ubuntu-kde is Wayland-only in current webtop images (needs PIXELFLUX_WAYLAND
# and Wayland ozone in the launcher); ubuntu-xfce runs the classic X11 mode.
ARG BASE_IMAGE=lscr.io/linuxserver/webtop:ubuntu-xfce
FROM ${BASE_IMAGE}

ARG PAWWORK_DIR=/app/pawwork
ENV PAWWORK_DIR=${PAWWORK_DIR}

# ---------------------------------------------------------------------------
# Base system packages: Electron's shared-library requirements plus the build
# toolchain (node-pty/koffi compile from source when no prebuilt is available).
# Ubuntu 24.04 (noble) renamed some libs with a t64 suffix; fall back to the
# legacy names on older bases.
# ---------------------------------------------------------------------------
RUN set -eux; \
    apt-get update; \
    if apt-get install -y --no-install-recommends \
        curl ca-certificates git \
        build-essential python3 make g++ \
        libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
        libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
        libgbm1 libasound2t64 libpango-1.0-0 libcairo2 \
        libayatana-appindicator3-1 libsecret-1-0 libnotify4 \
        x11-utils xdg-utils; \
    then :; \
    else \
        apt-get install -y --no-install-recommends \
            libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
            libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
            libgbm1 libasound2 libpango-1.0-0 libcairo2 \
            libayatana-appindicator3-1 libsecret-1-0 libnotify4 \
            x11-utils xdg-utils; \
    fi; \
    rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Node.js 24 (required by PawWork) and the exact pnpm of the repo manifest.
# ---------------------------------------------------------------------------
RUN set -eux; \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -; \
    apt-get install -y nodejs; \
    rm -rf /var/lib/apt/lists/*; \
    npm install -g pnpm@11.23.0; \
    node --version; \
    pnpm --version

# ---------------------------------------------------------------------------
# Node dependencies. Manifests and patches are copied before the source so the
# expensive `pnpm install` layer (incl. the Electron binary download) is cached
# and only the fast build layer re-runs when source changes.
# ---------------------------------------------------------------------------
WORKDIR ${PAWWORK_DIR}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ patches/
COPY packages/desktop-electron/package.json packages/desktop-electron/
COPY site/package.json site/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Full source, then the desktop build (electron-vite build -> out/).
# ---------------------------------------------------------------------------
COPY . .
RUN pnpm --filter @pawwork/desktop build

# ---------------------------------------------------------------------------
# Launcher plumbing.
#   - /custom-services.d/pawwork  -> supervised s6 service that auto-launches
#     PawWork on the desktop once the X server is up (LinuxServer hook).
#   - /usr/share/applications/pawwork.desktop -> launch PawWork from the menu.
# ---------------------------------------------------------------------------
COPY docker/webtop/run-pawwork.sh /usr/local/bin/run-pawwork.sh
COPY docker/webtop/pawwork.desktop /usr/share/applications/pawwork.desktop
RUN chmod +x /usr/local/bin/run-pawwork.sh \
    && mkdir -p /custom-services.d \
    && printf '#!/bin/bash\nexec /usr/local/bin/run-pawwork.sh\n' > /custom-services.d/pawwork \
    && chmod +x /custom-services.d/pawwork

# The webtop image's own entrypoint (/init) boots Xvfb, the desktop and the
# browser UI; it stays intact — /init is never overridden here.