const POWERSHELL_UTF8_PREAMBLE =
  "[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding;"

export function powerShellCommandArgs(command: string) {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(`${POWERSHELL_UTF8_PREAMBLE}\n${command}`, "utf16le").toString("base64"),
  ]
}
