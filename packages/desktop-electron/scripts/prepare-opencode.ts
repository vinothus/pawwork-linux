import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import manifest from "../bundled-tools.json"
import { powershellExpandArchiveArgs, type SupportedArch, type SupportedPlatform } from "./prepare-uv"

const execFileAsync = promisify(execFile)
const toolsDir = path.resolve(import.meta.dirname, "../resources/tools")
const opencode = manifest.opencode

export function isSupportedTarget(platform: SupportedPlatform | "linux", arch: SupportedArch) {
  return Object.prototype.hasOwnProperty.call(opencode.assets, `${platform}-${arch}`)
}

function assetEntryForTarget(platform: SupportedPlatform | "linux", arch: SupportedArch) {
  const entry = opencode.assets[`${platform}-${arch}` as keyof typeof opencode.assets]
  if (!entry) throw new Error(`Unsupported opencode target: ${platform}-${arch}`)
  return entry
}

export function assetForTarget(platform: SupportedPlatform | "linux", arch: SupportedArch) {
  return assetEntryForTarget(platform, arch).name
}

export function pinnedSha256ForTarget(platform: SupportedPlatform | "linux", arch: SupportedArch) {
  return assetEntryForTarget(platform, arch).sha256.toLowerCase()
}

export function binaryNameForPlatform(platform: SupportedPlatform | "linux") {
  return platform === "win32" ? "opencode.exe" : "opencode"
}

export function opencodeDownloadUrl(version: string, asset: string) {
  return `https://github.com/${opencode.repo}/releases/download/${version}/${asset}`
}

export function sha256(data: ArrayBuffer) {
  return createHash("sha256").update(Buffer.from(data)).digest("hex")
}

async function fetchBytes(url: string) {
  const response = await fetch(url, { redirect: "follow" })
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  return response.arrayBuffer()
}

async function extractArchive(archivePath: string, asset: string, destDir: string) {
  if (asset.endsWith(".zip")) {
    if (process.platform === "win32") {
      await execFileAsync("powershell.exe", powershellExpandArchiveArgs(archivePath, destDir))
    } else {
      await execFileAsync("unzip", ["-o", archivePath, "-d", destDir])
    }
    return
  }
  if (asset.endsWith(".tar.gz")) {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destDir])
    return
  }
  throw new Error(`Unsupported opencode asset archive format: ${asset}`)
}

async function findFile(rootDir: string, name: string): Promise<string | null> {
  const entries = await readdir(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const found = await findFile(full, name)
      if (found) return found
    }
  }
  return null
}

export async function verifyOpencodeVersion(binaryPath: string) {
  const { stdout } = await execFileAsync(binaryPath, ["--version"])
  if (!stdout.trim()) throw new Error(`opencode version probe returned empty output from ${binaryPath}`)
}

export async function prepareOpencode(platform: SupportedPlatform | "linux", arch: SupportedArch) {
  const asset = assetForTarget(platform, arch)
  const runtimeName = binaryNameForPlatform(platform)
  const assetUrl = opencodeDownloadUrl(opencode.version, asset)
  const expected = pinnedSha256ForTarget(platform, arch)

  const data = await fetchBytes(assetUrl)
  const actual = sha256(data)
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${asset}: expected ${expected} (pinned in bundled-tools.json), got ${actual}. ` +
        `If upstream re-released ${opencode.version}, review the release and update the pinned sha256 explicitly.`,
    )
  }

  await mkdir(toolsDir, { recursive: true })
  for (const stale of ["opencode", "opencode.exe"]) {
    await rm(path.join(toolsDir, stale), { force: true })
  }

  const extractDir = await mkdtemp(path.join(tmpdir(), "opencode-extract-"))
  try {
    const archivePath = path.join(extractDir, asset)
    await writeFile(archivePath, Buffer.from(data))
    await extractArchive(archivePath, asset, extractDir)

    const found = await findFile(extractDir, runtimeName)
    if (!found) throw new Error(`Extracted opencode archive ${asset} is missing ${runtimeName}`)
    const destination = path.join(toolsDir, runtimeName)
    await copyFile(found, destination)
    if (platform !== "win32") await chmod(destination, 0o755)
  } finally {
    await rm(extractDir, { recursive: true, force: true })
  }

  const destination = path.join(toolsDir, runtimeName)
  if (platform === process.platform && arch === process.arch) {
    await verifyOpencodeVersion(destination)
  }

  return { asset, destination, version: opencode.version }
}

function readArg(name: string) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

if (import.meta.main) {
  const platform = (readArg("--platform") ?? process.platform) as SupportedPlatform | "linux"
  const arch = (readArg("--arch") ?? process.arch) as SupportedArch
  if (!isSupportedTarget(platform, arch)) {
    console.log(`No pinned opencode asset for ${platform}-${arch}; skipping prepare-opencode`)
  } else {
    const result = await prepareOpencode(platform, arch)
    console.log(`Prepared opencode ${result.version} for ${platform}-${arch}: ${result.destination}`)
  }
}
