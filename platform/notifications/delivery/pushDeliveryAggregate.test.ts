import { describe, expect, it } from 'vitest'

import type { NotificationDeliveryState, NotificationRecord } from '../contracts/notificationContracts'
import { aggregatePushDelivery } from './aggregatePushDelivery'

/**
 * 一次通知 = N 条尝试（方案 §3）。聚合只有四档，**不许出现第五档**，
 * 唯一硬判据是：`sent-accepted` 当且仅当**所有**目标通道都 delivered。
 *
 * 聚合 `reason` 只在「全败」时写：1 成 2 败时写一个失败原因，会让读者以为整条都失败；
 * 逐通道原因在 `channels[]` 里，一个都不丢。
 */

const at = '2026-11-12T12:00:00.000Z'

describe('aggregatePushDelivery', () => {
  it('is sent-accepted only when every channel delivered', () => {
    expect(aggregatePushDelivery([
      { channelId: 'a', state: 'sent-accepted', at },
      { channelId: 'b', state: 'sent-accepted', at }
    ])).toEqual({ state: 'sent-accepted' })
  })

  it('is failed with no aggregate reason when only some channels failed', () => {
    const result = aggregatePushDelivery([
      { channelId: 'a', state: 'sent-accepted', at },
      { channelId: 'b', state: 'failed', reason: 'channel-rejected', at },
      { channelId: 'c', state: 'failed', reason: 'delivery-no-target-bound', at }
    ])
    // 不许把某一条的原因抬成整条的原因：读者会以为全部失败。
    expect(result).toEqual({ state: 'failed' })
  })

  it('keeps the first reason when every channel failed', () => {
    expect(aggregatePushDelivery([
      { channelId: 'a', state: 'failed', reason: 'channel-rejected', at },
      { channelId: 'b', state: 'failed', reason: 'delivery-no-target-bound', at }
    ])).toEqual({ state: 'failed', reason: 'channel-rejected' })
  })

  it('is sent-unconfirmed, never sent-accepted, when something was sent without a receipt', () => {
    expect(aggregatePushDelivery([
      { channelId: 'a', state: 'sent-accepted', at },
      { channelId: 'b', state: 'sent-accepted', at },
      { channelId: 'c', state: 'sent-unconfirmed', at }
    ])).toEqual({ state: 'sent-unconfirmed' })
  })

  it('is queued when every channel only waited out its backoff', () => {
    expect(aggregatePushDelivery([
      { channelId: 'a', state: 'queued', at },
      { channelId: 'b', state: 'queued', at }
    ])).toEqual({ state: 'queued' })
  })

  it('treats a failed channel as worse than a queued one and an unconfirmed as worse than queued', () => {
    expect(aggregatePushDelivery([
      { channelId: 'a', state: 'queued', at },
      { channelId: 'b', state: 'failed', reason: 'channel-rejected', at }
    ])).toEqual({ state: 'failed' })
    expect(aggregatePushDelivery([
      { channelId: 'a', state: 'queued', at },
      { channelId: 'b', state: 'sent-unconfirmed', at }
    ])).toEqual({ state: 'sent-unconfirmed' })
  })

  it('refuses to call an empty fan-out a success', () => {
    // 0 条可用通道是「没有」，不是「都送到了」——空集合不许真空成立成 accepted。
    expect(aggregatePushDelivery([])).toEqual({ state: 'failed', reason: 'push-unavailable' })
  })
})

describe('record shape stays readable for old records', () => {
  it('accepts a push state without the per-channel array', () => {
    const legacy: NotificationDeliveryState = { state: 'sent-accepted', at }
    expect('channels' in legacy).toBe(false)
    const record: NotificationRecord['delivery'] = { push: legacy }
    expect(record.push?.channels).toBeUndefined()
  })
})
