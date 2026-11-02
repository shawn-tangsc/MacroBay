/**
 * The timeline's bounded read helper and its error classifier.
 *
 * Pure and clock-only: they answer "how long may one read wait" and "is this refusal the
 * already-available one". They live beside the hook so the hook stays about read ordering and what
 * a failure keeps on screen.
 */

/** Resolves a read against a bounded wait so a silent service cannot hang the UI. */
export async function withReadTimeout<T>(read: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read,
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs) })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function isAlreadyAvailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('analysis-already-available')
}
