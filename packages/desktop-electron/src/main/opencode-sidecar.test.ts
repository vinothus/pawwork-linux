import { join } from "node:path"

import { describe, expect, test } from "vitest"

import {
  OPENCODE_WRAP_READY_MESSAGE,
  opencodeBinaryName,
  resolveBundledOpencodeExecutable,
  resolveOpencodeWrapScript,
} from "./opencode-sidecar"

describe("opencode-sidecar helpers", () => {
  test("maps platform to bundled binary names", () => {
    expect(opencodeBinaryName("win32")).toBe("opencode.exe")
    expect(opencodeBinaryName("linux")).toBe("opencode")
  })

  test("resolves bundled executable and wrap script under product resources", () => {
    expect(resolveBundledOpencodeExecutable("/resources/tools", "win32")).toBe(join("/resources/tools", "opencode.exe"))
    expect(resolveOpencodeWrapScript("/resources/dsh")).toBe(join("/resources/dsh", "opencode-wrap", "server.cjs"))
  })

  test("uses a stable ready message literal", () => {
    expect(OPENCODE_WRAP_READY_MESSAGE).toBe("pawwork:opencode-wrap-ready")
  })
})
