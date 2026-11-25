import { describe, expect, it } from 'vitest'

import type { NotificationCenterItem } from '@platform/notifications/contracts/notificationCenterContracts'

import { platformText } from '../../i18n/platformText'

import { textRowModel } from './textRowModel'

const text = platformText['zh-CN'].notifications.detail.poster

type Push = NotificationCenterItem['delivery']['push']

const row = (state: NonNullable<Push>['state']) => ({
  channelId: `c-${state}`,
  channelName: state,
  state,
  at: '2026-11-25T00:00:00.000Z'
})

describe('「文字」那一行（#46 §4）', () => {
  it('shows nothing when the record has no push at all', () => {
    // 没有推送对象：整个「送达」组连同这一行都不出现。
    expect(textRowModel(undefined, text)).toBeNull()
  })

  it('falls back to the aggregate row for old records without per-channel rows', () => {
    // 老记录没有逐通道行：按聚合那一条说，单通道不写数字，也不编通道名。
    expect(textRowModel({ state: 'sent-accepted', at: '2026-11-25T00:00:00.000Z' }, text)).toEqual({ state: 'sent' })
    expect(textRowModel({ state: 'failed', reason: 'channel-rejected', at: '2026-11-25T00:00:00.000Z' }, text))
      .toEqual({ state: 'failed' })
  })

  it('uses the same counting rule as the poster row: all / partial / single', () => {
    const push = (states: NonNullable<Push>['state'][]): Push => ({
      state: 'sent-accepted',
      at: '2026-11-25T00:00:00.000Z',
      channels: states.map(row)
    })
    expect(textRowModel(push(['sent-accepted', 'sent-accepted']), text)).toEqual({ state: 'sent', counts: '2 条通道' })
    expect(textRowModel(push(['sent-accepted']), text)).toEqual({ state: 'sent' })
    expect(textRowModel(push(['sent-accepted', 'queued']), text)).toEqual({ state: 'unconfirmed', counts: '1/2' })
    expect(textRowModel(push(['sent-accepted', 'failed']), text)).toEqual({ state: 'failed', counts: '1/2' })
  })

  it('never carries a reason: the text failure reason was already said in the list', () => {
    // §4：原因在列表正文里说过，详情不重复，也不进 ⓘ。
    const model = textRowModel({
      state: 'failed',
      reason: 'channel-rejected',
      at: '2026-11-25T00:00:00.000Z',
      channels: [{ ...row('failed'), reason: 'channel-rejected', reasonKind: null } as never]
    }, text)
    expect(model).toEqual({ state: 'failed' })
  })
})
