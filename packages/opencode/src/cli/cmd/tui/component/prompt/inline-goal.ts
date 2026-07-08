/**
 * Detect an inline `/goal` command embedded anywhere in a prompt: the user may
 * write `/goal` not only at the start of the line but mid-sentence to tag the
 * surrounding text as the session goal condition.
 *
 * `/goal` must be a standalone token — preceded by start-of-input or whitespace
 * and followed by whitespace or end-of-input. This prevents false positives on
 * `/goals`, URLs/paths like `example.com/goal/list`, or the literal mentioned in
 * a question ("how do I use /goal?"), all of which must keep flowing through as
 * ordinary chat.
 *
 * The goal condition is the text on both sides of `/goal`, joined. Returns
 * undefined when no standalone inline `/goal` is present.
 */
export function parseInlineGoalCommand(input: string): { command: "goal"; arguments: string } | undefined {
  const match = /(^|\s)(\/goal)(?=\s|$)/.exec(input)
  if (!match) return undefined

  const commandStart = match.index + match[1].length
  const commandEnd = commandStart + "/goal".length
  const before = input.slice(0, commandStart).replace(/[ \t]+$/, "")
  const after = input.slice(commandEnd).replace(/^[ \t]+/, "")
  const separator = before && after && !before.endsWith("\n") && !after.startsWith("\n") ? " " : ""
  const args = (before + separator + after).trim()

  return { command: "goal", arguments: args }
}
