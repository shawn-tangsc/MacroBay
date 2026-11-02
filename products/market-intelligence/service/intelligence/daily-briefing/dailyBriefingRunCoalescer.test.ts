import { describe, expect, it } from 'vitest'

import { createDailyBriefingRunCoalescer } from './dailyBriefingRunCoalescer'

describe('daily briefing run coalescer', () => {
  it('joins the run already working on an edition instead of starting a second one', async () => {
    const runs = createDailyBriefingRunCoalescer<string>()
    let starts = 0
    const start = async (): Promise<string> => {
      starts += 1
      return 'edition'
    }

    const key = runs.key('2026-10-30', 'default', 'zh-CN')
    const [first, second] = await Promise.all([runs.join(key, start), runs.join(key, start)])

    expect([first, second]).toEqual(['edition', 'edition'])
    expect(starts).toBe(1)
  })

  it('keys the run by period, so two periods generate at the same time', async () => {
    const runs = createDailyBriefingRunCoalescer<string>()
    expect(runs.key('2026-10-30', 'default', 'zh-CN')).not.toBe(runs.key('2026-10-30', 'asia-open', 'zh-CN'))
  })

  it('starts a fresh run once the previous one settled and drops its snapshot', async () => {
    const runs = createDailyBriefingRunCoalescer<string>()
    const key = runs.key('2026-10-30', 'default', 'zh-CN')
    let starts = 0
    const start = async (): Promise<string> => {
      starts += 1
      runs.progress.set(key, { stage: 'editorial', stageStartedAt: '2026-10-30T00:00:00.000Z' } as never)
      return `run-${starts}`
    }

    expect(await runs.join(key, start)).toBe('run-1')
    // The finished trace is stored with the result; a snapshot left here would be a second copy.
    expect(runs.progress.has(key)).toBe(false)
    expect(await runs.join(key, start)).toBe('run-2')
  })
})
