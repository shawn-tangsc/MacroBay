// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { NotificationPosterEvidence } from '@platform/notifications/contracts/notificationPosterContracts'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { platformText } from '../../i18n/platformText'

import { PosterDeliveryRow } from './PosterDeliveryRow'
import { posterRowModel } from './posterRowModel'

const labels = platformText['zh-CN'].notifications
const text = labels.detail.poster
const css = readFileSync(join(__dirname, 'deliveryRow.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const channel = (
  id: string,
  patch: Partial<NotificationPosterEvidence['channels'][number]> = {}
): NotificationPosterEvidence['channels'][number] => ({
  channelId: id,
  channelName: id.toUpperCase(),
  supportsImage: true,
  state: 'sent-accepted',
  reasonKind: null,
  at: '2026-11-25T00:00:00.000Z',
  ...patch
})

/** 一条「有图、有推送对象」的证据；各用例只改它相关的那一格。 */
function poster(patch: Partial<NotificationPosterEvidence> = {}): NotificationPosterEvidence {
  return {
    edition: { status: 'ready', contentHash: 'hash-1', failureCode: null, reasonKind: null },
    enabledImageChannelCount: 1,
    unsupportedImageChannelCount: 0,
    channels: [channel('a')],
    ...patch
  }
}

describe('海报行：整行出不出现（#46 判据一）', () => {
  it('hides the row when the record carries no poster evidence at all', () => {
    // poster 缺席 = 没有推送对象 / 老记录没有这份事实。没有接收方就没有「发没发」。
    expect(posterRowModel(undefined, text)).toBeNull()
  })

  it('hides the row when no enabled channel can take an image, even if evidence leaked through', () => {
    // 契约保证 N＝0 时整块不给；这里再挡一次——不能落成「已发送 0/0」。
    expect(posterRowModel(poster({ enabledImageChannelCount: 0, channels: [] }), text)).toBeNull()
  })
})

describe('海报行：四态', () => {
  it('says 已发送 when every enabled image channel accepted the poster', () => {
    expect(posterRowModel(poster({ enabledImageChannelCount: 2, channels: [channel('a'), channel('b')] }), text))
      .toEqual({ state: 'sent', counts: '2 条通道', hints: [] })
  })

  it('says 这一版没有图 when the poster table had no row — and never a failure', () => {
    // edition === null 是「没有」，不是「失败」；也不能由此编一个原因。
    // 通道行也为空：一条图片通道都没试过，才是「这一版没有图」这一档。
    expect(posterRowModel(poster({ edition: null, channels: [] }), text)).toEqual({ state: 'noImage', hints: [] })
  })

  it('says 等回执 when a channel is still queued or unconfirmed, with no failure', () => {
    const partial = poster({
      enabledImageChannelCount: 2,
      channels: [channel('a'), channel('b', { state: 'queued' })]
    })
    expect(posterRowModel(partial, text)).toEqual({ state: 'unconfirmed', counts: '1/2', hints: [] })
    // queued 就归这一档：这一行不该出现第五个状态。
    const allQueued = poster({ enabledImageChannelCount: 2, channels: [channel('a', { state: 'queued' }), channel('b', { state: 'queued' })] })
    expect(posterRowModel(allQueued, text)).toEqual({ state: 'unconfirmed', counts: '2 条通道', hints: [] })
  })

  it('says 未发送 with the channel reason when a channel failed', () => {
    const model = posterRowModel(poster({
      enabledImageChannelCount: 2,
      channels: [
        channel('a'),
        channel('b', { state: 'failed', reasonKind: 'channel-refused', reasonCode: 'channel-rejected' })
      ]
    }), text)
    expect(model).toEqual({ state: 'failed', counts: '1/2', reason: '通道未收下', hints: [] })
  })

  it('says 未发送 with the render reason when the poster never rendered', () => {
    // 出图这一步失败时零尝试；原因必须说出图，不能推给通道。
    const timeout = poster({
      enabledImageChannelCount: 2,
      edition: { status: 'timeout', contentHash: null, failureCode: 'poster-render-timeout', reasonKind: 'render-timeout' },
      channels: []
    })
    expect(posterRowModel(timeout, text)).toEqual({ state: 'failed', counts: '2 条通道', reason: '出图超时', hints: [] })

    const failed = poster({
      edition: { status: 'failed', contentHash: null, failureCode: 'poster-too-large', reasonKind: 'too-large' },
      channels: []
    })
    expect(posterRowModel(failed, text)).toEqual({ state: 'failed', reason: '图太大', hints: [] })
  })

  it('trusts the channel rows over the frozen poster row when both exist', () => {
    // v1.3：手动「发布到手机」会把逐通道结果写回同一条记录，而 `edition` 仍是推送那一刻的冻结值，
    // 于是会出现「出图超时 + 两条已送达」。照行优先读，读者手机上有图却被写成「未发送·出图超时」。
    const model = posterRowModel(poster({
      enabledImageChannelCount: 2,
      edition: { status: 'timeout', contentHash: null, failureCode: 'poster-render-timeout', reasonKind: 'render-timeout' },
      channels: [channel('a'), channel('b')]
    }), text)
    expect(model).toEqual({ state: 'sent', counts: '2 条通道', hints: [] })
  })

  it('says 未发送 when an enabled image channel was never tried this time', () => {
    // N − channels = 启用着、这次没被试过的条数：没试过也是「没发出去」，读者要知道。
    const model = posterRowModel(poster({
      enabledImageChannelCount: 3,
      channels: [channel('a'), channel('b')]
    }), text)
    expect(model).toEqual({ state: 'failed', counts: '1/3', reason: '通道不可用', hints: [] })
  })

  it('writes counts only — no guessed word — when the reason code is unknown', () => {
    const model = posterRowModel(poster({
      enabledImageChannelCount: 2,
      channels: [channel('a'), channel('b', { state: 'failed', reasonKind: null, reasonCode: 'some-new-code' })]
    }), text)
    expect(model).toEqual({ state: 'failed', counts: '1/2', hints: [] })
  })

  it('leaves the number out when there is a single channel', () => {
    // 单通道不写数字：写「1/1」比不写更像噪音。
    expect(posterRowModel(poster({ channels: [channel('a', { state: 'failed', reasonKind: 'channel-refused' })] }), text))
      .toEqual({ state: 'failed', reason: '通道未收下', hints: [] })
  })
})

describe('海报行：ⓘ 只有两种出现条件', () => {
  it('lists each channel when two channels failed for different reasons', () => {
    const model = posterRowModel(poster({
      enabledImageChannelCount: 2,
      channels: [
        channel('binance', { channelName: '币安频道', state: 'failed', reasonKind: 'channel-refused' }),
        channel('hook', { channelName: 'Webhook', state: 'failed', reasonKind: 'channel-unavailable' })
      ]
    }), text)
    expect(model?.reason).toBe('多个原因')
    expect(model?.hints).toEqual(['币安频道：通道未收下', 'Webhook：通道不可用'])
  })

  it('keeps one reason in the value, with no ⓘ, when two channels failed the same way', () => {
    const model = posterRowModel(poster({
      enabledImageChannelCount: 2,
      channels: [
        channel('a', { state: 'failed', reasonKind: 'channel-refused' }),
        channel('b', { state: 'failed', reasonKind: 'channel-refused' })
      ]
    }), text)
    expect(model).toEqual({ state: 'failed', counts: '2 条通道', reason: '通道未收下', hints: [] })
  })

  it('counts every failed channel when deciding 多个原因, and only names the ones it can', () => {
    const model = posterRowModel(poster({
      enabledImageChannelCount: 2,
      channels: [
        channel('a', { channelName: '甲', state: 'failed', reasonKind: 'channel-refused' }),
        channel('b', { channelName: undefined, state: 'failed', reasonKind: 'image-unavailable' })
      ]
    }), text)
    // 名字只决定 ⓘ 那一行画不画，不该把「两种原因」压成一种（契约保证失败行有名字）。
    expect(model?.reason).toBe('多个原因')
    expect(model?.hints).toEqual(['甲：通道未收下'])
  })

  it('explains the channels that cannot take an image at all', () => {
    const model = posterRowModel(poster({
      enabledImageChannelCount: 1,
      unsupportedImageChannelCount: 1,
      channels: [channel('a')]
    }), text)
    // 单通道不写数字（§3；§5 也写了「1 channel 那种情况根本走不到」），这里只有那颗 ⓘ。
    expect(model).toEqual({ state: 'sent', hints: ['1 个通道不支持图片，未计入'] })
  })

  it('keeps both kinds of hint when both conditions hold', () => {
    const model = posterRowModel(poster({
      enabledImageChannelCount: 2,
      unsupportedImageChannelCount: 2,
      channels: [
        channel('a', { channelName: '甲', state: 'failed', reasonKind: 'channel-refused' }),
        channel('b', { channelName: '乙', state: 'failed', reasonKind: 'image-unavailable' })
      ]
    }), text)
    expect(model?.hints).toEqual(['2 个通道不支持图片，未计入', '甲：通道未收下', '乙：图没能取到'])
  })
})

describe('海报行：渲染', () => {
  let root: Root | undefined

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
  })

  async function mount(evidence: NotificationPosterEvidence | undefined): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <ShellLanguageProvider language="zh-CN">
          <dl>
            <PosterDeliveryRow poster={evidence} labels={labels} />
          </dl>
        </ShellLanguageProvider>
      )
    })
    return host
  }

  it('renders one dl row: 海报 label, the status pill, the number and the reason', async () => {
    const host = await mount(poster({
      enabledImageChannelCount: 2,
      channels: [channel('a'), channel('b', { state: 'failed', reasonKind: 'channel-refused' })]
    }))
    const row = host.querySelector('.notification-delivery-row')
    expect(row).not.toBeNull()
    expect(row?.querySelector('dt')?.textContent).toBe('海报')
    // 药丸是平台 StatusPill（`<span>`，不是按钮），档位走 bad。
    const pill = row?.querySelector('.status-pill')
    expect(pill?.className).toContain('status-pill--bad')
    expect(pill?.tagName).toBe('SPAN')
    expect(pill?.textContent).toBe('未发送')
    expect(row?.querySelector('.notification-delivery-row__counts')?.textContent).toBe('1/2')
    expect(row?.querySelector('.notification-delivery-row__reason')?.textContent).toBe('通道未收下')
    // 药丸不在 `dd` 之外：读屏先念标签、再念值。
    expect(pill?.closest('dd')).toBe(row?.querySelector('dd'))
  })

  it('renders no row at all when the evidence is missing', async () => {
    const host = await mount(undefined)
    expect(host.querySelector('.notification-delivery-row')).toBeNull()
  })

  it('adds a ⓘ whose name is the platform sentence, and no ⓘ when there is nothing to add', async () => {
    const withHint = await mount(poster({ enabledImageChannelCount: 2, unsupportedImageChannelCount: 1, channels: [channel('a')] }))
    const button = withHint.querySelector<HTMLButtonElement>('.notification-delivery-row button')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-label')).toBe('查看说明')
    expect(button?.getAttribute('aria-expanded')).toBe('false')

    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    const without = await mount(poster())
    expect(without.querySelector('.notification-delivery-row button')).toBeNull()
  })

  it('renders the separator from copy, and only when there is a reason', async () => {
    // 有数字 + 有原因：一个分隔点。
    const both = await mount(poster({
      enabledImageChannelCount: 2,
      channels: [channel('a'), channel('b', { state: 'failed', reasonKind: 'channel-refused' })]
    }))
    // 分隔点渲染的是**文案表里那一条**（不在这里钉具体空格：值由简报线的那张表定）。
    expect([...both.querySelectorAll('.notification-delivery-row__separator')].map((node) => node.textContent))
      .toEqual([text.value.separator])

    // 只有数字、没有原因：不渲染分隔点。
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    const countsOnly = await mount(poster({ enabledImageChannelCount: 2, channels: [channel('a'), channel('b')] }))
    expect(countsOnly.querySelectorAll('.notification-delivery-row__separator')).toHaveLength(0)

    // 单通道失败：没有数字，但「· 通道未收下」照旧要读得出来。
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    const single = await mount(poster({ channels: [channel('a', { state: 'failed', reasonKind: 'channel-refused' })] }))
    expect(single.querySelectorAll('.notification-delivery-row__separator')).toHaveLength(1)
    expect(single.querySelector('.notification-delivery-row__reason')?.textContent).toBe('通道未收下')
  })

  it('keeps the value on one line and the label column at 40', () => {
    // happy-dom 不做布局：这里钉住「让一行成立」的两条声明，真机折行由界面设计复验。
    expect(css).toMatch(/\.notification-delivery-row\s*\{[^}]*grid-template-columns:\s*40px minmax\(0,\s*1fr\)/)
    expect(css).toMatch(/\.notification-delivery-row\s*>\s*dd\s*\{[^}]*white-space:\s*nowrap/)
    expect(css).toMatch(/\.notification-delivery-row\s*>\s*dd\s*\{[^}]*min-width:\s*0/)
  })
})

describe('海报行：文案键全部来自壳的文案表', () => {
  it('uses the landed platform keys, one per state', () => {
    // 三个共用状态词在 `detail.state`（「文字」「海报」两行同一个词）；只有 `noImage` 留在这里。
    for (const state of ['sent', 'unconfirmed', 'failed'] as const) {
      expect(labels.detail.state[state].length).toBeGreaterThan(0)
    }
    expect(text.state.noImage.length).toBeGreaterThan(0)
    // 状态词不带参数（StatusPill 只收键）：四个都必须是字符串，不是函数。
    expect(typeof labels.detail.state.sent).toBe('string')
  })
})