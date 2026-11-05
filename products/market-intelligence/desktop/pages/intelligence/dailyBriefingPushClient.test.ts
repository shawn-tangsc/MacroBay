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
const edition = { date: '2026-11-04', periodId: 'default', locale: 'en-US' as const }

/** 发布走产品 IPC：主进程先写/更新记录，再重投。渲染层只发一个请求。 */
function stubBridge(result: unknown): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async () => result)
  vi.stubGlobal('window', { platform: { products: { invoke } } })
  return invoke
}

afterEach(() => vi.unstubAllGlobals())

describe('the push client', () => {
  it('addresses the edition, so two issues of a day do not share one record', () => {
    expect(briefingPushDedupeKey(edition)).toBe('briefing-ready:2026-11-04:default:en-US')
    // Same day, another period or language: a different record, not the first issue's.
    expect(briefingPushDedupeKey({ ...edition, periodId: 'period_x' })).toBe('briefing-ready:2026-11-04:period_x:en-US')
    expect(briefingPushDedupeKey({ ...edition, locale: 'zh-CN' })).toBe('briefing-ready:2026-11-04:default:zh-CN')
    expect(briefingPushEditionId(edition)).toBe('2026-11-04:en-US:default')
  })

  it('asks for the edition on screen, in its own language, through the product bridge', async () => {
    const invoke = stubBridge({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted' } })
    await redeliverBriefingPush(edition)
    // One call: 主进程内部先写记录再重投，渲染层不该自己拼两步（那会把顺序交给调用点）。
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligence.dailyBriefing.publishToPhone', {
      date: '2026-11-04', periodId: 'default', locale: 'en-US'
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
      ['redeliver-surface-invalid', 'surface-invalid'],
      ['push-paused', 'push-paused'],
      ['channel-missing', 'channel-not-configured'],
      // 主进程先写后推之后，剩下的「记录不在」其实是「这一版还没生成」：读者要做的事一样，同一句。
      ['edition-missing', 'record-missing'],
      ['runtime-unavailable', 'runtime-unavailable']
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
