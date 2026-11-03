import { describe, expect, it } from 'vitest'

import type { ChannelDeliveryTargetView } from '@platform/ai/agent-platform/channels/ChannelManagementContracts'

import { buildChannelRowState, channelColumnReady } from './channelRow'

function target(overrides: Partial<ChannelDeliveryTargetView> = {}): ChannelDeliveryTargetView {
  return {
    id: 'telegram-1',
    name: 'Telegram · 观潮播报',
    deliverable: true,
    reason: null,
    target: { kind: 'bound', conversationKind: 'direct' },
    ...overrides
  }
}

const build = (input: {
  channels: readonly ChannelDeliveryTargetView[]
  channelId?: string | null
  lastPushFailureAt?: string | null
}) =>
  buildChannelRowState({
    channels: input.channels,
    channelId: input.channelId ?? null,
    lastPushFailureAt: input.lastPushFailureAt ?? null
  })

describe('the channel row tells four different situations apart', () => {
  it('says there is no channel, and offers no selector, when nothing can deliver', () => {
    // 一条都没有：不画空下拉。空下拉把「没有」说成「挑一个」。
    expect(build({ channels: [] })).toEqual({ kind: 'not-wired' })
    // 有通道但都没通过验证（不可投递）也算「没有」，选择器里不许出现不可用的那几条。
    expect(
      build({ channels: [target({ deliverable: false, reason: 'not-enabled' })] })
    ).toEqual({ kind: 'not-wired' })
  })

  it('keeps an available channel and a selected channel apart', () => {
    const channels = [target()]
    // 有通道、但读者没选：推送是关着的，这不是「未接入」。
    expect(build({ channels })).toEqual({
      kind: 'unselected',
      choices: [{ id: 'telegram-1', name: 'Telegram · 观潮播报' }]
    })
  })

  it('lists only the deliverable channels, so a blocked one never appears in the selector', () => {
    const state = build({
      channels: [
        target({ id: 'telegram-1', name: 'Telegram' }),
        target({ id: 'slack-1', name: 'Slack', deliverable: false, reason: 'credential-missing' })
      ],
      channelId: 'telegram-1'
    })
    expect(state.kind).toBe('ready')
    expect(state.kind === 'ready' ? state.choices : []).toEqual([{ id: 'telegram-1', name: 'Telegram' }])
  })

  it('falls back to "nothing selected" when the selected channel is no longer deliverable', () => {
    // 通道被停用后，界面不能还显示「已选一条不能发的通道」。
    const state = build({
      channels: [target({ id: 'telegram-1' }), target({ id: 'slack-1', deliverable: false })],
      channelId: 'slack-1'
    })
    expect(state.kind).toBe('unselected')
  })

  it('says the target is unbound instead of pretending a channel is ready', () => {
    const state = build({ channels: [target({ target: { kind: 'unbound' } })], channelId: 'telegram-1' })
    expect(state).toMatchObject({ kind: 'unbound', selectedId: 'telegram-1', channelName: 'Telegram · 观潮播报' })
  })

  it('refuses to pick between several bound conversations', () => {
    // 绑了多个会话：不发、不猜，去通道页只留一个。
    const state = build({
      channels: [target({ target: { kind: 'ambiguous', count: 3 } })],
      channelId: 'telegram-1'
    })
    expect(state).toMatchObject({ kind: 'ambiguous', selectedId: 'telegram-1' })
  })

  it('reports the last failed push as a past fact, not as a current switch', () => {
    const state = build({ channels: [target()], channelId: 'telegram-1', lastPushFailureAt: '2026-11-02T13:37:00.000Z' })
    expect(state).toMatchObject({
      kind: 'failed',
      target: 'direct',
      failedAt: '2026-11-02T13:37:00.000Z'
    })
  })

  it('stays silent when the channel is usable and nothing failed', () => {
    expect(build({ channels: [target()], channelId: 'telegram-1' })).toMatchObject({ kind: 'ready', target: 'direct' })
  })
})

describe('the subscription channel column exists only when the channel is really ready', () => {
  it('is not drawn while there is no offer, no pick, or no target', () => {
    expect(channelColumnReady(build({ channels: [] }))).toBe(false)
    expect(channelColumnReady(build({ channels: [target()] }))).toBe(false)
    expect(channelColumnReady(build({ channels: [target({ target: { kind: 'unbound' } })], channelId: 'telegram-1' }))).toBe(false)
    expect(
      channelColumnReady(build({ channels: [target({ target: { kind: 'ambiguous', count: 2 } })], channelId: 'telegram-1' }))
    ).toBe(false)
  })

  it('is drawn once a channel is picked and its target is bound, including after a failed push', () => {
    expect(channelColumnReady(build({ channels: [target()], channelId: 'telegram-1' }))).toBe(true)
    expect(
      channelColumnReady(
        build({ channels: [target()], channelId: 'telegram-1', lastPushFailureAt: '2026-11-02T13:37:00.000Z' })
      )
    ).toBe(true)
  })
})
