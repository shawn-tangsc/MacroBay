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
 * 「推送到手机」接线：页面层点到主进程的那一段。
 *
 * 判的都是渲染输出与调用次数，不扫源码：一个按钮能不能点、点三次发几次、失败留在哪，这些才是
 * 读者能看见的事实。2026-11-05 起失败与回执都走平台 toast（工具栏只留按钮），所以「有没有留痕」
 * 判的是 toast，不是工具栏那一行字。
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
/** 工具栏这一行：回执与失败都不许出现在它里面（toast 是宿主里的另一块，不算）。 */
const toolbarText = (): string => container.querySelector('.mi-daily-briefing-page__report-bar')?.textContent ?? ''
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

  it('says it was handed over in a toast, never that it was delivered, and leaves the toolbar clean', async () => {
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(window.document.body.textContent).toContain('已交给 贾维斯')
    expect(window.document.body.textContent).not.toMatch(/已送达|已推送|发送成功|Delivered/)
    // 工具栏里只有按钮：回执不许常驻在那一行。
    expect(toolbarText()).not.toContain('已交给 贾维斯')
    await act(async () => { vi.advanceTimersByTime(3_000) })
    expect(window.document.body.textContent).not.toContain('已交给 贾维斯')
  })

  it('keeps the half-sentence when no receipt came back', async () => {
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-unconfirmed' } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(window.document.body.textContent).toContain('已交给 贾维斯（未拿到回执）')
  })

  it('reports a failure as a toast with a retry, and puts nothing in the toolbar', async () => {
    invoke.mockResolvedValue({ kind: 'rejected', reason: 'redeliver-edition-mismatch' })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(window.document.body.textContent).toContain(`${zh.failedTitle}：${zh.failed['edition-mismatch']}`)
    // 工具栏不许再挂那行「没发出去…重试」（用户原话：字丑、别一直显示在界面上）。
    expect(toolbarText()).not.toContain(zh.failed['edition-mismatch'])
    expect(toolbarText()).not.toContain(zh.failedTitle)

    const retry = Array.from(window.document.body.querySelectorAll('button')).find((entry) => entry.textContent?.includes(zh.retry))
    await act(async () => { retry?.click() })
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
    expect(window.document.body.textContent).toContain('已交给 贾维斯')
  })
})
