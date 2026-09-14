# PawWork in a Linux webtop container (Linux test rig)

A Docker/Podman setup that runs PawWork inside a full Linux desktop
([LinuxServer.io webtop](https://docs.linuxserver.io/images/docker-webtop/)) —
built from source and auto-launched on the desktop — so you can open
<http://localhost:3000> in any browser and verify PawWork's UI on Linux
visually: click, type, see the window render, screenshots, etc.

```
your browser ──► http://localhost:3000  ──► webtop desktop (XFCE on Xvfb)
                                              └── PawWork window (Electron, DSH sidecar)
```

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | webtop base + Node 24/pnpm + build deps + `pnpm install` + `electron-vite build`, bakes a supervised auto-start service |
| `run-pawwork.sh` | waits for the X server, then launches the built app (or `pnpm dev:desktop` in dev mode) |
| `pawwork.desktop` | app-menu entry on the desktop (launch PawWork by hand) |
| `docker-compose.yml` | one-command build & run |

## What you get

- **Desktop UI**: XFCE on Xvfb, streamed to the browser on port 3000. The
  `ubuntu-xfce` flavor is used on purpose: Electron is rock-solid on the X11
  stack. Current `ubuntu-kde` webtop images are Wayland-only; see
  [Switching the desktop flavor](#switching-the-desktop-flavor) if you want KDE anyway.
- **PawWork built from source**: pinned Node 24 + pnpm 11.23, `pnpm install
  --frozen-lockfile`, then the desktop `electron-vite build`.
- **Auto-launch**: an s6 supervised service (`/custom-services.d/pawwork`)
  starts PawWork on the desktop as soon as the X server is up, and restarts it
  if it exits.
- **Persistent home**: app data lives under `/config` (volume `webtop-config`),
  the webtop home of user `abc`.

## Quick start (Docker)

```bash
cd pawwork

# 1. build the image (5–15 min first time: npm + Electron binary download)
docker build -f docker/webtop/Dockerfile -t pawwork-linux-test .

# 2. run it
docker run -d \
  --name pawwork-linux \
  --restart unless-stopped \
  --security-opt label=disable \
  -p 3000:3000 \
  -p 3001:3001 \
  -e TZ=Asia/Kolkata \
  -e CUSTOM_USER=vinoth \
  -e PASSWORD='Vindec@2026' \
  -e PUID=1000 \
  -e PGID=1000 \
  --shm-size=4g \
  -v webtop-config:/config \
  -v webtop-data:/data \
  pawwork-linux-test

# 3. open in your browser
#    http://localhost:3000      login: vinoth / Vindec@2026
```

Podman is identical — just replace `docker` with `podman`
(`--security-opt label=disable` is especially relevant there).

## Quick start (compose)

```bash
cd pawwork
docker compose -f docker/webtop/docker-compose.yml up -d --build
# or: podman compose -f docker/webtop/docker-compose.yml up -d --build
```

## Verifying the UI

1. Open <http://localhost:3000> and sign in (basic auth).
2. The PawWork window should already be open on the desktop (it auto-starts).
   If not, click the app-menu (bottom-left) → *Office* → **PawWork**.
3. Watch the container log while it starts:

   ```bash
   docker logs -f pawwork-linux        # podman logs -f pawwork-linux
   ```

   You should see webtop boot lines, then `[pawwork] launching mode=built ...`.
4. PawWork's own logs: `docker exec pawwork-linux bash -lc 'cat $(ls ~/.config/pawwork*/logs/main.log)'`

## Iterating on code

Rebuilds are cheap after the first: the `pnpm install` layer (including the
Electron binary) is cached, so a source change only re-runs the build step:

```bash
docker compose -f docker/webtop/docker-compose.yml up -d --build
# or (no compose):
# docker build -f docker/webtop/Dockerfile -t pawwork-linux-test . && docker restart pawwork-linux
```

Prefer an HMR dev server instead? Set `PAWWORK_RUN_MODE=dev` (compose
`environment:` or `-e PAWWORK_RUN_MODE=dev`). Dev mode needs write access to
`packages/desktop-electron/out`, so run as root then (`-e PUID=0`) or
`chown -R abc:abc /app/pawwork` inside the container once.

## Switching the desktop flavor

- **XFCE (default, recommended for Electron/X11)**: `ubuntu-xfce` — used by
  default, Xvfb + X11, no extra flags.
- **KDE**: current `ubuntu-kde` webtop images are **Wayland-only**. To use it:
  - `docker build --build-arg BASE_IMAGE=lscr.io/linuxserver/webtop:ubuntu-kde -f docker/webtop/Dockerfile -t pawwork-linux-test .`
  - run with `-e PIXELFLUX_WAYLAND=true`; the launcher detects `WAYLAND_DISPLAY`
    and adds `--ozone-platform=wayland` automatically.

## Verified working on Linux (2026-09-14)

Built and run on Docker Desktop (Linux engine, amd64). Verified:

- webtop desktop reachable at `http://localhost:3000` (basic auth `vinoth` / `Vindec@2026`)
- PawWork auto-launches on the desktop — window titled **PawWork** (`WM_CLASS pawwork-desktop`) confirmed via `wmctrl -l -x`
- **Project CI smoke passes inside the container** (`pnpm exec tsx scripts/ci-smoke.ts raw` with `ELECTRON_DISABLE_SANDBOX=1`):
  `verified DSH product UI, free-model routing, and bundled skills` · `free-model turn on opencode/big-pickle: answered` · `verified DSH session persistence and dangling host-link repair after restart` · `verified V1 session and Automation migration after restart`

### Linux fix included in this branch

`packages/desktop-electron/src/main/index.ts`: `electron-updater`'s `autoUpdater`
getter refuses app versions that are not valid semver. An unpackaged Linux run
started by script path (`electron out/main/index.js` — how the smoke harness
launches it) reports the default-app version `"0.0"`; macOS/Windows fall back to
a bundle version, so only Linux hit the `App version is not a valid semver
version: "0.0"` crash at import. Since every updater use is gated behind
`UPDATER_ACTIVE`, the app now normalizes the version (`app.setVersion("0.0.0")`)
when `app.getVersion()` is not valid semver, instead of letting an inactive
updater take the process down.

## Notes & gotchas

- **`--no-sandbox` is intentional.** Chromium's sandbox needs setuid helpers /
  user namespaces that containers don't provide; this is the standard
  container setup for Electron apps.
- **Software rendering**: Xvfb has no GPU, so rendering is CPU/SwiftShader —
  normal for this kind of rig.
- **`--shm-size=4g`**: Chromium shared memory; keep it.
- **Password character caveat**: the webtop nginx renders its config with plain
  `sed`, and characters like `@` in `PASSWORD` are documented to occasionally
  break that. The example works in practice, but if the login page misbehaves,
  try a simpler password.
- **No auth**: if you drop `CUSTOM_USER`/`PASSWORD`, the web UI is open — fine
  on a trusted network only.
- First boot takes ~30–60 s (desktop + PawWork start); the PawWork window then
  opens automatically.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Image build fails in `pnpm install` (Electron download) | GitHub rate limit on the Electron binary — retry, or set `ELECTRON_MIRROR` (e.g. a npmmirror) via `--build-arg` is not wired yet; add `ENV ELECTRON_MIRROR=...` before the install step |
| `[pawwork] X server not found` | webtop desktop failed to start; check `docker logs` for Xvfb/selkies errors |
| Browser page has no desktop / wrong resolution | wait a bit longer; reload the page; adjust `MAX_RES`/resolution env for the selkies UI |
| PawWork window missing but log says launching | give the WM time; click the app menu → *Office* → PawWork |
| App exits instantly, log shows Chromium errors | `docker logs pawwork-linux` shows Electron stderr because `ELECTRON_ENABLE_LOGGING=1` |