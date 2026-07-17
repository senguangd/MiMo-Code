from pathlib import Path

path = Path("packages/opencode/test/session/llm.test.ts")
text = path.read_text()

old = '''function waitRequest(pathname: string, response: Response) {
  const pending = deferred<Capture>()
  state.queue.push({ path: pathname, response, resolve: pending.resolve })
  return pending.promise
}
'''
new = '''function waitRequest(pathname: string, response: Response) {
  const pending = deferred<Capture>()
  state.queue.push({ path: pathname, response, resolve: pending.resolve })
  return pending.promise
}

function waitTokenCount(totalTokens = 1) {
  return waitRequest("/utils/token_counter", Response.json({ total_tokens: totalTokens }))
}
'''
if text.count(old) != 1:
    raise RuntimeError("waitRequest anchor changed")
text = text.replace(old, new)

old = '''    const model = fixture.model

    const request = waitRequest(
      "/chat/completions",
'''
new = '''    const model = fixture.model

    const counter = waitTokenCount()
    const request = waitRequest(
      "/chat/completions",
'''
if text.count(old) != 1:
    raise RuntimeError("options test anchor changed")
text = text.replace(old, new)

old = '''        const capture = await request
        const body = capture.body
'''
new = '''        const counted = await counter
        const capture = await request
        const body = capture.body
'''
if text.count(old) != 1:
    raise RuntimeError("capture anchor changed")
text = text.replace(old, new)

old = '''        expect(body.model).toBe(resolved.api.id)
        expect(body.temperature).toBe(0.4)
'''
new = '''        expect(counted.url.pathname).toBe("/utils/token_counter")
        expect(counted.body.model).toBe(resolved.api.id)
        expect(body.model).toBe(resolved.api.id)
        expect(body.temperature).toBe(0.4)
'''
if text.count(old) != 1:
    raise RuntimeError("assertion anchor changed")
text = text.replace(old, new)

old = '''    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model
    const pending = waitStreamingRequest("/chat/completions")
'''
new = '''    const fixture = await loadFixture(providerID, modelID)
    const model = fixture.model
    const counter = waitTokenCount()
    const pending = waitStreamingRequest("/chat/completions")
'''
if text.count(old) != 1:
    raise RuntimeError("cancellation setup anchor changed")
text = text.replace(old, new)

old = '''        await pending.request
        ctrl.abort()
'''
new = '''        await counter
        await pending.request
        ctrl.abort()
'''
if text.count(old) != 1:
    raise RuntimeError("cancellation request anchor changed")
text = text.replace(old, new)

path.write_text(text)
print("llm token-counter tests updated")
