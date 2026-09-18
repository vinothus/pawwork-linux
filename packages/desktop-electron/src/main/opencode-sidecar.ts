import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type AddressInfo } from "node:net"
import { join } from "node:path"

export const OPENCODE_WRAP_READY_MESSAGE = "pawwork:opencode-wrap-ready"

export type OpencodeSidecarRun = {
  ready: Promise<string>
  exited: Promise<number | null>
  stop(): Promise<void>
}

type LaunchOpencodeSidecarOptions = {
  nodeExecutable: string
  wrapScript: string
  opencodeExecutable: string
  cwd: string
  env: NodeJS.ProcessEnv
  healthTimeoutMs?: number
  stopTimeoutMs?: number
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  onError?: (error: Error) => void
}

const DEFAULT_HEALTH_TIMEOUT_MS = 30_000
const DEFAULT_STOP_TIMEOUT_MS = 5_000

function freePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, host, () => {
      const port = (server.address() as AddressInfo).port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

export function opencodeBinaryName(platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? "opencode.exe" : "opencode"
}

export function resolveBundledOpencodeExecutable(toolsDir: string, platform: NodeJS.Platform = process.platform) {
  return join(toolsDir, opencodeBinaryName(platform))
}

export function resolveOpencodeWrapScript(resourcesDshDir: string) {
  return join(resourcesDshDir, "opencode-wrap", "server.cjs")
}

function readyUrlOf(message: unknown) {
  if (typeof message !== "object" || message === null) return undefined
  const { type, url } = message as { type?: unknown; url?: unknown }
  if (type !== OPENCODE_WRAP_READY_MESSAGE || typeof url !== "string") return undefined
  return url
}

async function waitForHealth(baseUrl: string, timeoutMs: number, signal?: AbortSignal) {
  const healthUrl = `${baseUrl.replace(/\/v1\/?$/, "")}/health`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("OpenCode sidecar start aborted")
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch {
      /* retry until deadline */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`OpenCode wrap server did not become healthy within ${timeoutMs}ms`)
}

export async function launchOpencodeSidecar(options: LaunchOpencodeSidecarOptions): Promise<OpencodeSidecarRun> {
  const wrapPort = await freePort()
  const opencodePort = await freePort()
  const wrapBaseUrl = `http://127.0.0.1:${wrapPort}/v1`
  const healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS

  const child = spawn(
    options.nodeExecutable,
    [options.wrapScript],
    {
      env: {
        ...options.env,
        ELECTRON_RUN_AS_NODE: "1",
        WRAP_PORT: String(wrapPort),
        OPENCODE_PORT: String(opencodePort),
        OPENCODE_BASE: `http://127.0.0.1:${opencodePort}`,
        PAWWORK_OPENCODE_EXECUTABLE: options.opencodeExecutable,
        WRAP_CWD: options.cwd,
      },
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  ) as ChildProcess

  let exitedAlready = false
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => {
      exitedAlready = true
      resolve(code)
    })
  })

  let settled = false
  let stopping: Promise<void> | undefined
  let rejectReady!: (error: Error) => void

  const waitForExit = () => {
    if (exitedAlready) return Promise.resolve(true)
    return new Promise<boolean>((resolveWait) => {
      const waitTimeout = setTimeout(() => resolveWait(false), stopTimeoutMs)
      void exited.then(() => {
        clearTimeout(waitTimeout)
        resolveWait(true)
      })
    })
  }

  const cleanupReadiness = () => {
    child.off("message", onMessage)
    child.off("exit", onEarlyExit)
  }

  const stopProcess = () => {
    stopping ??= (async () => {
      if (!settled) {
        settled = true
        cleanupReadiness()
        rejectReady(new Error("OpenCode sidecar stopped before readiness"))
      }
      if (exitedAlready || child.pid === undefined) return
      try {
        child.send("SIGTERM")
      } catch {
        child.kill()
      }
      if (await waitForExit()) return
      if (!exitedAlready) child.kill("SIGKILL")
      await waitForExit()
    })()
    return stopping
  }

  const fail = async (error: Error, terminate: boolean) => {
    if (settled) return
    settled = true
    cleanupReadiness()
    rejectReady(error)
    if (terminate && child.pid !== undefined) await stopProcess()
  }

  const onEarlyExit = (code: number | null) => {
    void fail(new Error(`OpenCode sidecar exited before readiness ${code === null ? "without a status code" : `with code ${code}`}`), false)
  }

  const onSpawnError = (error: Error) => {
    options.onError?.(error)
    void fail(new Error(`OpenCode sidecar failed to start: ${error.message}`, { cause: error }), true)
  }

  let resolveReady!: (url: string) => void
  const announced = new Promise<string>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const ready = announced.then(async (url) => {
    await waitForHealth(url, healthTimeoutMs)
    return url
  })

  const onMessage = (message: unknown) => {
    const url = readyUrlOf(message)
    if (url === undefined) return
    settled = true
    cleanupReadiness()
    resolveReady(url)
  }

  child.on("message", onMessage)
  child.stdout?.on("data", (data: Buffer | string) => options.onStdout?.(data.toString()))
  child.stderr?.on("data", (data: Buffer | string) => options.onStderr?.(data.toString()))
  child.once("exit", onEarlyExit)
  child.on("error", onSpawnError)
  void ready.catch(async (error) => {
    if (settled) return
    await fail(error instanceof Error ? error : new Error(String(error)), true)
  })

  return { ready, exited, stop: stopProcess }
}
