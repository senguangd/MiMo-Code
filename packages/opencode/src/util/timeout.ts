export function withTimeout<T>(promise: Promise<T>, ms: number, message = `Operation timed out after ${ms}ms`): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message))
    }, ms)
  })

  return Promise.race([promise, deadline]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout)
  })
}
