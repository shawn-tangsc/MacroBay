// @vitest-environment happy-dom
import { act } from 'react'
import { ConfigProvider } from 'antd'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { ToastHost } from '@platform/ui/components/toast'
import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { DailyBriefingEditionActions } from './DailyBriefingPageActions'
import { briefingPushText } from './dailyBriefingPushText'
import { useBriefingPushToPhone } from './useBriefingPushToPhone'

/**
 * 「发布频道」接线：页面层点到主进程的那一段。
 *
 * 判的都是渲染输出与调用次数，不扫源码：一个按钮能不能点、点三次发几次、失败留在哪，这些才是
 * 读者能看见的事实。海报之后，结果改成工具栏下方**固定的一行**（正文只有数字与动作、逐条说明在 ⓘ），
 * 因为它要能同时放「几条收到」「哪条只发了文字」和两个动作——toast 装不下这些。
 */
const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const zh = briefingPushText['zh-CN']

const document = (locale: 'zh-CN' | 'en-US' = 'zh-CN') => ({
  edition: { date: '2026-11-05', locale, generatedAt: '2026-11-05T00:30:00.000Z', windowStart: '2026-11-04T00:30:00.000Z', windowEnd: '2026-11-05T00:30:00.000Z', timeZone: 'Asia/Shanghai' }
} as unknown as DailyBriefingDocument)

const invoke = vi.fn()
const getDeliverySettings = vi.fn()

function Row(input: Readonly<{
  edition?: DailyBriefingDocument
  generating?: boolean
  localeMissing?: boolean
  refreshKey?: number
}>): React.ReactElement {
  const push = useBriefingPushToPhone({
    document: input.edition,
    generating: input.generating ?? false,
    localeMissing: input.localeMissing ?? false,
    periodId: 'default',
    text: zh,
    ...(input.refreshKey === undefined ? {} : { refreshKey: input.refreshKey })
  })
  return <DailyBriefingEditionActions
    text={text} resolveText={(key) => key}
    generating={input.generating ?? false} exportable={false}
    exportState="idle" copyState="idle" push={push} pushText={zh}
    onExport={() => undefined} onCopy={() => undefined} onRegenerate={() => undefined} />
}

let container: HTMLDivElement
let root: Root

const render = (element: React.ReactElement): void => {
  act(() => {
    root.render(<ConfigProvider button={WINDOW_ANTD_BUTTON_CONFIG}><ConfirmProvider><ToastHost>{element}</ToastHost></ConfirmProvider></ConfigProvider>)
  })
}
const button = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>('.mi-daily-briefing__push button') as HTMLButtonElement
/** 结果那一行（工具栏下方、卡顶固定区）：发布之后它才出现。 */
const resultText = (): string => container.querySelector('[data-push-result]')?.textContent ?? ''
const push = async (): Promise<void> => { await act(async () => { button().click() }) }

beforeEach(() => {
  container = window.document.createElement('div')
  window.document.body.append(container)
  root = createRoot(container)
  invoke.mockReset().mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted' } })
  getDeliverySettings.mockReset().mockResolvedValue({ pushWired: true, channels: [{ id: 'c1', name: '贾维斯', deliverable: true }] })
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke }, notifications: { getDeliverySettings } }
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.useRealTimers()
  delete (window as unknown as { platform?: unknown }).platform
})

describe('the publish control on the page', () => {
  it('publishes the edition on screen through the product bridge', async () => {
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    expect(getDeliverySettings).toHaveBeenCalled()

    await push()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligence.dailyBriefing.publishToPhone', {
      date: '2026-11-05', periodId: 'default', locale: 'zh-CN'
    })
  })

  it('sends once when a slow network invites three clicks', async () => {
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { button().click(); button().click(); button().click() })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('shows the result under the toolbar, never claiming delivery and never naming a channel in the body', async () => {
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted', channels: [
      { channelId: 'c1', channelName: '贾维斯', state: 'sent-accepted', kind: 'image' }
    ] } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(resultText()).toContain('1 条通道都收到了')
    expect(resultText()).not.toContain('贾维斯')
    expect(window.document.body.textContent).not.toMatch(/已送达|已推送|已发送|发送成功|Delivered/)
  })

  it('keeps the neutral half-sentence when no receipt came back', async () => {
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-unconfirmed' } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(resultText()).toContain('已送出去，还没收到回执')
  })

  it('marks the channel that was downgraded to text instead of calling it a poster', async () => {
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted', channels: [
      { channelId: 'c1', channelName: '贾维斯', state: 'sent-accepted', kind: 'image' },
      { channelId: 'c2', channelName: '飞书群', state: 'sent-accepted', kind: 'text' }
    ] } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(resultText()).toContain('2 条通道都收到了')
    // ⓘ 里逐条说清：一条发了海报、一条只发了文字。
    const trigger = container.querySelector('[data-push-result] button[aria-label="这次每条通道的结果"]') as HTMLButtonElement
    await act(async () => { trigger.click() })
    const rows = [...window.document.body.querySelectorAll('[data-push-channels] li')].map((row) => row.textContent)
    expect(rows).toEqual(['贾维斯发了海报 · 收到了', '飞书群只发了文字 · 收到了'])
  })

  it('keeps a failure in its own row with a retry action, not in the toolbar buttons', async () => {
    invoke.mockResolvedValue({ kind: 'rejected', reason: 'redeliver-edition-mismatch' })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(resultText()).toContain(`${zh.failedTitle}：${zh.failed['edition-mismatch']}`)

    const retry = container.querySelector('[data-push-action="retry"]') as HTMLButtonElement
    expect(retry.textContent).toBe(zh.retry)
    await act(async () => { retry.click() })
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('explains each blocked situation in its own words and blocks the button', async () => {
    const cases = [
      { props: { generating: true }, reason: 'generating' as const },
      { props: { localeMissing: true }, reason: 'missing-locale' as const },
      { props: { document: undefined }, reason: 'no-edition' as const }
    ]
    for (const entry of cases) {
      render(<Row edition={entry.props.document} generating={entry.props.generating} localeMissing={entry.props.localeMissing} />)
      await act(async () => { await Promise.resolve() })
      expect(button().disabled).toBe(true)
      expect(container.textContent).toContain(zh.disabled[entry.reason])
      act(() => { root.unmount() })
      root = createRoot(container)
    }
    // The build that cannot send at all is its own sentence, not 「暂时不能发」.
    getDeliverySettings.mockResolvedValue({ pushWired: false, channels: [] })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    expect(button().disabled).toBe(true)
    expect(container.textContent).toContain(zh.disabled.capability)
  })

  it('keeps every disabled reason out of the toolbar surface, structurally', async () => {
    // 用户 2026-11-05：「把按钮禁用就行了，别说废话」。按结构判——工具栏里每条原因都必须是
    // sr-only（仍在 DOM、仍被 aria-describedby 指着），不是把这四句硬编码成黑名单。
    const cases = [
      { props: { generating: true } },
      { props: { localeMissing: true } },
      { props: { document: undefined } }
    ]
    for (const entry of cases) {
      render(<Row edition={entry.props.document} generating={entry.props.generating} localeMissing={entry.props.localeMissing} />)
      await act(async () => { await Promise.resolve() })
      const bar = container.querySelector('.mi-daily-briefing-page__report-bar')!
      const reasons = Array.from(bar.querySelectorAll('.disabled-hint__reason'))
      expect(reasons.length).toBeGreaterThan(0)
      for (const node of reasons) expect(node.getAttribute('data-reason-display')).toBe('sr-only')
      const describedBy = button().getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      expect(reasons.some((node) => describedBy!.includes(node.id))).toBe(true)
      act(() => { root.unmount() })
      root = createRoot(container)
    }
  })

  it('pushes the English edition the reader is looking at, not the master-language one', async () => {
    // 读者切成英文、点推送，收到的必须是英文版：只要这一版真在通知里（editionId+locale 对得上）就推，
    // 不为「非主语言」另设禁用分支——那会把「去重新生成」的出路堵掉。
    const english = document('en-US')
    render(<Row edition={english} />)
    await act(async () => { await Promise.resolve() })
    expect(button().disabled).toBe(false)
    await push()
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligence.dailyBriefing.publishToPhone', {
      date: '2026-11-05', periodId: 'default', locale: 'en-US'
    })
  })

  it('re-reads the channel when it may have been configured elsewhere', async () => {
    // 读者跑去配通道再回来：按钮不能永远带着挂载时那个「这个版本推不了」的结论。
    getDeliverySettings.mockResolvedValue({ pushWired: false, channels: [] })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    expect(button().disabled).toBe(true)
    expect(container.textContent).toContain(zh.disabled.capability)

    getDeliverySettings.mockResolvedValue({ pushWired: true, channels: [{ id: 'c1', name: '贾维斯', deliverable: true }] })
    render(<Row edition={document()} refreshKey={1} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(getDeliverySettings).toHaveBeenCalledTimes(2)
    expect(button().disabled).toBe(false)

    await push()
    // 通道重新读到之后按钮可点了，结果那一行说的是「收到」，不再点名某一条通道。
    expect(resultText()).toContain('通道收到了')
  })
})
