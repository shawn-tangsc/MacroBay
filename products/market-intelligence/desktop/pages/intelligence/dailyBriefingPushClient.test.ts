// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  briefingPushAvailable,
  briefingPushDedupeKey,
  briefingPushEditionId,
  redeliverBriefingPush
} from './dailyBriefingPushClient'

/**
 * The reader's push, from the click to the sentence.
 *
 * Two things are pinned here and they are the ones a screenshot cannot show: what the platform is
 * asked (the day's key, the screen's edition, the screen's language) and what a rejection is called.
 * A wrong key pushes nothing; a wrong edition pushes a different issue; a code shown raw is a sentence
 * the reader cannot act on.
 */
const edition = { date: '2026-11-04', periodId: 'default', locale: 'en-US' }

function stubBridge(result: unknown): ReturnType<typeof vi.fn> {
  const redeliverPush = vi.fn(async () => result)
  vi.stubGlobal('window', { platform: { notifications: { redeliverPush } } })
  return redeliverPush
}

afterEach(() => vi.unstubAllGlobals())

describe('the push client', () => {
  it('addresses the day, not the issue', () => {
    // One completion record per day: a key carrying the period addresses a row that does not exist.
    expect(briefingPushDedupeKey('2026-11-04')).toBe('briefing-ready:2026-11-04')
    expect(briefingPushEditionId(edition)).toBe('2026-11-04:en-US:default')
  })

  it('asks the platform for the edition on screen, in its own language', async () => {
    const redeliverPush = stubBridge({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted' } })
    await redeliverBriefingPush(edition)
    expect(redeliverPush).toHaveBeenCalledWith({
      dedupeKey: 'briefing-ready:2026-11-04',
      editionId: '2026-11-04:en-US:default',
      locale: 'en-US'
    })
  })

  it('reads the receipt, not the port: a send without one is not called sent', async () => {
    stubBridge({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-unconfirmed' } })
    expect(await redeliverBriefingPush(edition)).toEqual({ state: 'sent', delivery: 'sent-unconfirmed' })

    stubBridge({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted' } })
    expect(await redeliverBriefingPush(edition)).toEqual({ state: 'sent', delivery: 'sent-accepted' })
  })

  it('names each rejection in words a reader can act on', async () => {
    for (const [code, reason] of [
      ['redeliver-target-missing', 'record-missing'],
      ['redeliver-edition-mismatch', 'edition-mismatch'],
      ['push-paused', 'push-paused'],
      ['channel-missing', 'channel-not-configured']
    ] as const) {
      stubBridge({ kind: 'rejected', reason: code })
      // The platform's code never reaches the screen; the card gets one of these names.
      expect(await redeliverBriefingPush(edition)).toEqual({ state: 'failed', reason })
    }
  })

  it('is unavailable, not broken, in a build without the runtime', async () => {
    vi.stubGlobal('window', {})
    expect(briefingPushAvailable()).toBe(false)
    expect(await redeliverBriefingPush(edition)).toEqual({ state: 'failed', reason: 'runtime-unavailable' })
  })
})
