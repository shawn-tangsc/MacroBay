/**
 * Waits for a client call, but stops waiting after `ms`.
 *
 * The drawer's rescore / rebuild buttons stay busy until their call settles; without a deadline a
 * bridge that never answers leaves the button disabled forever. The timer is cleared when the call
 * settles, so a slow-but-successful call cannot fire a rejection after the fact.
 */
export function withTimeout<T>(promise: Promise<T>, ms = 8_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms)
  })
  return Promise.race([promise, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
