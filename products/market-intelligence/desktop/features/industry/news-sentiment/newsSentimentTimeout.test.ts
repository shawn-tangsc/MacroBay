import { describe, expect, it, vi } from 'vitest'

import { withTimeout } from './newsSentimentTimeout'

describe('withTimeout', () => {
  it('passes a result through when the call answers in time', async () => {
    await expect(withTimeout(Promise.resolve('value'), 50)).resolves.toBe('value')
  })

  it('rejects when the call never answers, so a button is not left busy forever', async () => {
    vi.useFakeTimers()
    try {
      const pending = withTimeout(new Promise<string>(() => undefined), 30)
      vi.advanceTimersByTime(31)
      await expect(pending).rejects.toThrow('timeout')
    } finally {
      vi.useRealTimers()
    }
  })
})
