import { describe, expect, test } from "vitest"

import manifest from "../bundled-tools.json"
import {
  assetForTarget,
  binaryNameForPlatform,
  isSupportedTarget,
  opencodeDownloadUrl,
  pinnedSha256ForTarget,
  sha256,
} from "./prepare-opencode"

describe("prepare-opencode manifest helpers", () => {
  test("maps supported targets to upstream opencode release assets", () => {
    expect(assetForTarget("win32", "x64")).toBe("opencode-windows-x64.zip")
    expect(assetForTarget("linux", "x64")).toBe("opencode-linux-x64.tar.gz")
  })

  test("skips unsupported targets without throwing from the guard", () => {
    expect(isSupportedTarget("darwin", "arm64")).toBe(false)
    expect(isSupportedTarget("win32", "x64")).toBe(true)
    expect(isSupportedTarget("linux", "x64")).toBe(true)
  })

  test("rejects unsupported targets at prepare time", () => {
    expect(() => assetForTarget("darwin" as any, "arm64")).toThrow("Unsupported opencode target: darwin-arm64")
  })

  test("pins a lowercase 64-hex sha256 in the repo manifest for every supported target", () => {
    for (const [platform, arch] of [
      ["win32", "x64"],
      ["linux", "x64"],
    ] as const) {
      const pinned = pinnedSha256ForTarget(platform, arch)
      expect(pinned).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  test("pins distinct hashes per asset", () => {
    const hashes = (["win32-x64", "linux-x64"] as const).map((key) => manifest.opencode.assets[key].sha256)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  test("uses platform runtime binary names", () => {
    expect(binaryNameForPlatform("linux")).toBe("opencode")
    expect(binaryNameForPlatform("win32")).toBe("opencode.exe")
  })

  test("builds pinned release URLs and does not use latest", () => {
    const url = opencodeDownloadUrl("v1.18.31", "opencode-windows-x64.zip")
    expect(url).toBe("https://github.com/anomalyco/opencode/releases/download/v1.18.31/opencode-windows-x64.zip")
    expect(url).not.toContain("/latest/")
  })

  test("hashes bytes to lowercase hex sha256", () => {
    expect(sha256(new TextEncoder().encode("hello").buffer)).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    )
  })
})
