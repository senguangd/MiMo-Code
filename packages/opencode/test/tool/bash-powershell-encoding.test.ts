import { describe, expect, test } from "bun:test"
import { powerShellCommandArgs } from "../../src/shell/powershell"

describe("PowerShell command encoding", () => {
  test("uses EncodedCommand with text output for pwsh", () => {
    const args = powerShellCommandArgs('echo "测试中文"', "pwsh")

    expect(args.slice(0, 3)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive"])
    expect(args.slice(3, 6)).toEqual(["-OutputFormat", "Text", "-EncodedCommand"])
    expect(args).not.toContain("-Command")

    const decoded = Buffer.from(args[6], "base64").toString("utf16le")
    expect(decoded).toContain("[Console]::InputEncoding")
    expect(decoded).toContain("[Console]::OutputEncoding")
    expect(decoded).toContain("[System.Text.UTF8Encoding]::new($false)")
    expect(decoded).toContain('echo "测试中文"')
  })

  test("uses plain Command for Windows PowerShell", () => {
    const args = powerShellCommandArgs('echo "测试中文"', "powershell")

    expect(args.slice(0, 3)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive"])
    expect(args[3]).toBe("-Command")
    expect(args).not.toContain("-EncodedCommand")
    expect(args[4]).toContain("[Console]::InputEncoding")
    expect(args[4]).toContain('echo "测试中文"')
  })
})
