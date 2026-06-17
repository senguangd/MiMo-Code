const POWERSHELL_UTF8_PREAMBLE =
  "[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding;"

const BASE_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive"]

export function powerShellCommandArgs(command: string, shell: "powershell" | "pwsh") {
  const script = `${POWERSHELL_UTF8_PREAMBLE}\n${command}`
  if (shell === "powershell") return [...BASE_ARGS, "-Command", script]

  return [
    ...BASE_ARGS,
    "-OutputFormat",
    "Text",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ]
}
