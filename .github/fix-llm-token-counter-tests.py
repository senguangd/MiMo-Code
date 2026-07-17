from pathlib import Path

path = Path("packages/opencode/test/session/llm.test.ts")
text = path.read_text()


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return value.replace(old, new)


def replace_in_test(value: str, name: str, replacements: list[tuple[str, str, str]]) -> str:
    start_marker = f'  test("{name}"'
    start = value.index(start_marker)
    end = value.find('\n  test("', start + len(start_marker))
    if end < 0:
        end = len(value)
    block = value[start:end]
    for old, new, label in replacements:
        block = replace_once(block, old, new, f"{name}: {label}")
    return value[:start] + block + value[end:]


text = replace_once(
    text,
    '''function waitRequest(pathname: string, response: Response) {
  const pending = deferred<Capture>()
  state.queue.push({ path: pathname, response, resolve: pending.resolve })
  return pending.promise
}
''',
    '''function waitRequest(pathname: string, response: Response) {
  const pending = deferred<Capture>()
  state.queue.push({ path: pathname, response, resolve: pending.resolve })
  return pending.promise
}

function waitTokenCount(totalTokens = 1) {
  return waitRequest("/utils/token_counter", Response.json({ total_tokens: totalTokens }))
}
''',
    "waitRequest helper",
)

text = replace_in_test(
    text,
    "sends temperature, tokens, and reasoning options for openai-compatible models",
    [
        (
            '''    const model = fixture.model

    const request = waitRequest(
''',
            '''    const model = fixture.model

    const counter = waitTokenCount()
    const request = waitRequest(
''',
            "queue token counter",
        ),
        (
            '''        const capture = await request
        const body = capture.body
''',
            '''        const counted = await counter
        const capture = await request
        const body = capture.body
''',
            "await token counter",
        ),
        (
            '''        expect(body.model).toBe(resolved.api.id)
        expect(body.temperature).toBe(0.4)
''',
            '''        expect(counted.url.pathname).toBe("/utils/token_counter")
        expect(counted.body.model).toBe(resolved.api.id)
        expect(body.model).toBe(resolved.api.id)
        expect(body.temperature).toBe(0.4)
''',
            "assert request order",
        ),
    ],
)

text = replace_in_test(
    text,
    "service stream cancellation cancels provider response body promptly",
    [
        (
            '''    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model
    const pending = waitStreamingRequest("/chat/completions")
''',
            '''    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model
    const counter = waitTokenCount()
    const pending = waitStreamingRequest("/chat/completions")
''',
            "queue token counter",
        ),
        (
            '''        await pending.request
        ctrl.abort()
''',
            '''        await counter
        await pending.request
        ctrl.abort()
''',
            "await token counter",
        ),
    ],
)

path.write_text(text)
print("llm token-counter tests updated")
