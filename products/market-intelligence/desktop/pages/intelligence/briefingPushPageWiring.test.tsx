// @vitest-environment happy-dom
import { act } from 'react'
import { ConfigProvider } from 'antd'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { ToastHost } from '@platform/ui/components/toast'
import { productText } from '../../shared/i18n/productText'
import { resolveProductTextKey } from '../../shared/i18n/productTextKey'
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
  posterRoot?: () => HTMLElement | null
  onShortenLede?: () => void
  onOpenChannels?: () => void
}>): React.ReactElement {
  const push = useBriefingPushToPhone({
    document: input.edition,
    generating: input.generating ?? false,
    localeMissing: input.localeMissing ?? false,
    periodId: 'default',
    text: zh,
    ...(input.refreshKey === undefined ? {} : { refreshKey: input.refreshKey }),
    ...(input.posterRoot === undefined ? {} : { posterRoot: input.posterRoot }),
    ...(input.onShortenLede === undefined ? {} : { onShortenLede: input.onShortenLede }),
    ...(input.onOpenChannels === undefined ? {} : { onOpenChannels: input.onOpenChannels })
  })
  return <DailyBriefingEditionActions
    text={text} resolveText={(key) => resolveProductTextKey('zh-CN', key)}
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
/** 结果条（工具栏下方、内容区顶部）：发布之后它才出现。 */
const strip = (): Element | null => container.querySelector('[data-push-result]')
/** 摘要那一句（不是整条的 textContent：明细行也在里面）。 */
const summaryText = (): string => strip()?.querySelector('[role="status"]')?.textContent ?? ''
/** 明细逐行：名字 | 结果 | 形态 | 原因。 */
const lineTexts = (): string[] => [...(strip()?.querySelectorAll('[data-push-line]') ?? [])].map((line) => [
  line.querySelector('.mi-daily-briefing__push-line-name')?.textContent ?? '',
  line.querySelector('.mi-daily-briefing__push-line-outcome')?.textContent ?? '',
  line.querySelector('.mi-daily-briefing__push-line-form')?.textContent ?? '',
  line.querySelector('.mi-daily-briefing__push-line-reason')?.textContent ?? ''
].join('|'))
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

  it('shows the result under the toolbar, never claiming delivery and never naming a channel in the summary', async () => {
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted', channels: [
      { channelId: 'c1', channelName: '贾维斯', state: 'sent-accepted', kind: 'image' }
    ] } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    // 这一版没有可渲染的纸（Row 不给 posterRoot）→ 形态前缀「只发了文字：」+ 全成摘要。
    expect(summaryText()).toBe('只发了文字：1 条通道都收到了')
    expect(summaryText()).not.toContain('贾维斯')
    // 通道名只在明细行里。
    expect(lineTexts()).toEqual(['贾维斯|收到|发了海报|'])
    expect(window.document.body.textContent).not.toMatch(/已送达|已推送|已发送|发送成功|Delivered/)
  })

  it('counts the three buckets apart: received, not received, and still waiting', async () => {
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'failed', channels: [
      { channelId: 'c1', channelName: '贾维斯', state: 'sent-accepted', kind: 'image' },
      { channelId: 'c2', channelName: '飞书群', state: 'sent-unconfirmed' },
      { channelId: 'c3', channelName: '邮件', state: 'failed', reason: 'channel-rejected', kind: 'text' }
    ] } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    // 未回执自成一桶——绝不并进「没到」。
    expect(summaryText()).toBe('只发了文字：1 条收到，1 条没到，1 条还没回执')
    expect(strip()?.getAttribute('data-tone')).toBe('caution')
  })

  it('keeps the neutral half-sentence when no receipt came back', async () => {
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-unconfirmed' } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(summaryText()).toBe('只发了文字：已送出去，还没收到回执')
  })

  it('marks the channel that was downgraded to text instead of calling it a poster', async () => {
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted', channels: [
      { channelId: 'c1', channelName: '贾维斯', state: 'sent-accepted', kind: 'image' },
      { channelId: 'c2', channelName: '飞书群', state: 'sent-accepted', kind: 'text' }
    ] } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(summaryText()).toBe('只发了文字：2 条通道都收到了')
    // 逐条说清：一条发了海报、一条只发了文字（没有海报）。
    expect(lineTexts()).toEqual(['贾维斯|收到|发了海报|', '飞书群|收到|只发了文字（没有海报）|'])
  })

  it('keeps a failure in its own row with a retry action, not in the toolbar buttons', async () => {
    invoke.mockResolvedValue({ kind: 'rejected', reason: 'redeliver-edition-mismatch' })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(summaryText()).toBe(`${zh.failedTitle}：${zh.failed['edition-mismatch']}`)

    const retry = container.querySelector('[data-push-action="retry"]') as HTMLButtonElement
    expect(retry.textContent).toBe(zh.retry)
    await act(async () => { retry.click() })
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('offers to resend only the missing ones when this message carried no poster', async () => {
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'failed', channels: [
      { channelId: 'c1', channelName: '贾维斯', state: 'sent-accepted', kind: 'text' },
      { channelId: 'c2', channelName: '飞书群', state: 'failed', reason: 'channel-rejected' }
    ] } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    const action = strip()?.querySelector('[data-push-action="retry-missing"]') as HTMLButtonElement
    expect(action.textContent).toBe(zh.retryMissing)
    // 「展开明细」与句内动作是同一套写法：antd 文本档 + `.text-action`（颜色取 `--accent`）。
    // 链接档走的是 antd 的 `colorLink`，会在一页里冒出第二个交互色。
    const toggle = strip()?.querySelector('[data-push-toggle]') as HTMLButtonElement
    for (const control of [action, toggle]) {
      expect(control.className).toContain('text-action')
      expect(control.className).toContain('ant-btn-text')
      expect(control.className).not.toContain('ant-btn-link')
    }
    await act(async () => { action.click() })
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('renders every outcome as a status pill, and puts the tone on the pill rather than on the word', async () => {
    // 三档状态词走平台 `StatusPill`：危险色只落在圆点与描边（`--danger` 当正文前景在深色下
    // 3.25–3.94，正文门槛 4.5）。收到 ok / 没到 bad / 等回执 info。
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'failed', channels: [
      { channelId: 'c1', channelName: '贾维斯', state: 'sent-accepted', kind: 'image' },
      { channelId: 'c2', channelName: '飞书群', state: 'failed', reason: 'channel-rejected' },
      { channelId: 'c3', channelName: '邮件', state: 'sent-unconfirmed' }
    ] } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    // 明细顺序：没到 / 等回执在前（永远可见），收到在后。
    const pills = [...(strip()?.querySelectorAll('.mi-daily-briefing__push-line-outcome .status-pill') ?? [])]
    expect(pills.map((pill) => pill.className)).toEqual([
      'status-pill status-pill--bad',
      'status-pill status-pill--info',
      'status-pill status-pill--ok'
    ])
    // 字上没有内联颜色：档位色归药丸的圆点与描边。
    expect(pills.every((pill) => (pill.getAttribute('style') ?? '') === '')).toBe(true)
  })

  it('offers to resend the missing ones on a poster result too; the delivery layer skips the channels that already got it', async () => {
    // 一成一败、已受理那条拿到的是海报。重发由投递层按「本次请求的意图」选路，并跳过已受理的通道
    // （频道线 `cb5ef08` 的用例钉住「只对没到的那条产生新尝试、一条都不补时不发」）；
    // 页面这一层的判据是：这颗动作出现，点它只再发起一次发布。
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'failed', channels: [
      { channelId: 'c1', channelName: '贾维斯', state: 'sent-accepted', kind: 'image' },
      { channelId: 'c2', channelName: '飞书群', state: 'failed', reason: 'channel-rejected' }
    ] } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    const action = strip()?.querySelector('[data-push-action="retry-missing"]') as HTMLButtonElement
    expect(action.textContent).toBe(zh.retryMissing)
    // 收到与没到照样逐条说清。
    expect(lineTexts().map((line) => line.split('|')[1])).toEqual(['没到', '收到'])
    await act(async () => { action.click() })
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('names every strip icon by its own short label, never by the sentence it opens', async () => {
    const tooLong = { ...document(), lede: { text: 'a'.repeat(1_100) } } as unknown as DailyBriefingDocument
    render(<Row edition={tooLong} posterRoot={() => window.document.createElement('div')} onShortenLede={() => undefined} />)
    await act(async () => { await Promise.resolve() })
    await push()
    const names = [...(strip()?.querySelectorAll('button[aria-label]') ?? [])]
      .map((node) => node.getAttribute('aria-label'))
    // 名字来自产品文案表的完整路径：路径真的能解析，读屏才拿得到名字。
    const expected = [
      'pages.intelligence.portal.dashboard.dailyBriefing.push.actionInfoLabel',
      'pages.intelligence.portal.dashboard.dailyBriefing.push.stripInfoLabel',
      'pages.intelligence.portal.dashboard.dailyBriefing.push.closeStrip'
    ].map((path) => resolveProductTextKey('zh-CN', path))
    expect(names).toEqual(expected)
    expect(names.every((name) => name !== '')).toBe(true)
    // 名字不是它弹出的那句话：读屏不该把整段解释当成按钮名。
    expect(names).not.toContain(zh.captionTooLongWhy)
  })

  it('registers the three screen-reader names in both languages, and a wrong path resolves to nothing', () => {
    const paths = [
      'pages.intelligence.portal.dashboard.dailyBriefing.push.actionInfoLabel',
      'pages.intelligence.portal.dashboard.dailyBriefing.push.stripInfoLabel',
      'pages.intelligence.portal.dashboard.dailyBriefing.push.closeStrip'
    ]
    for (const path of paths) {
      for (const language of ['zh-CN', 'en-US'] as const) {
        expect(resolveProductTextKey(language, path)).not.toBe('')
      }
    }
    // 写错一段路径就是空串——那正是一粒没有名字的按钮的来源，所以键必须真在表里。
    expect(resolveProductTextKey('zh-CN', 'pages.intelligence.portal.dashboard.dailyBriefing.push.notThere')).toBe('')
  })

  it('says where it is sending while it waits, with the channel count it can see', async () => {
    // 别线：请求挂着不返回，读者点完之后要看到「正在发到 N 条通道…」而不是一片空白。
    invoke.mockReturnValue(new Promise(() => undefined))
    getDeliverySettings.mockResolvedValue({ pushWired: true, channels: [
      { id: 'c1', name: '贾维斯', deliverable: true }, { id: 'c2', name: '飞书群', deliverable: true }
    ] })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(summaryText()).toBe('正在发到 2 条通道…')
    expect(strip()?.querySelector('[data-push-lines]')).toBeNull()
  })

  it('keeps failures and waiting rows visible when the reader folds the details', async () => {
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'failed', channels: [
      { channelId: 'c1', channelName: '贾维斯', state: 'sent-accepted' },
      { channelId: 'c2', channelName: '飞书群', state: 'failed', reason: 'channel-rejected' },
      { channelId: 'c3', channelName: '邮件', state: 'sent-unconfirmed' }
    ] } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(lineTexts()).toHaveLength(3)
    const toggle = strip()?.querySelector('[data-push-toggle]') as HTMLButtonElement
    await act(async () => { toggle.click() })
    // 收起的只是「收到」的那条；没到与等回执永远可见。
    expect(lineTexts().map((line) => line.split('|')[1])).toEqual(['没到', '等回执'])
  })

  it('offers one action at most: the caption case gives only "shorten the lede" and it opens the session', async () => {
    const shorten = vi.fn()
    const tooLong = { ...document(), lede: { text: 'a'.repeat(1_100) } } as unknown as DailyBriefingDocument
    render(<Row edition={tooLong} posterRoot={() => window.document.createElement('div')} onShortenLede={shorten} />)
    await act(async () => { await Promise.resolve() })
    await push()
    // 导读超长：整条不发，一次 IPC 都不发。
    expect(invoke).not.toHaveBeenCalled()
    expect(summaryText()).toContain('导读 1100 字')
    expect(strip()?.getAttribute('data-tone')).toBe('danger')
    const actions = [...(strip()?.querySelectorAll('[data-push-action]') ?? [])]
    expect(actions.map((action) => action.textContent)).toEqual(['改短导读'])
    await act(async () => { (actions[0] as HTMLButtonElement).click() })
    expect(shorten).toHaveBeenCalledTimes(1)
  })

  it('says there is no usable channel, and points at the channels page, instead of "nobody received"', async () => {
    const openChannels = vi.fn()
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'failed', reason: 'push-unavailable' } })
    render(<Row edition={document()} onOpenChannels={openChannels} />)
    await act(async () => { await Promise.resolve() })
    await push()
    // 一条可用通道都没有是「没发」，不是「没收到」。
    expect(summaryText()).toBe('没有可用的通道')
    const action = strip()?.querySelector('[data-push-action]') as HTMLButtonElement
    expect(action.textContent).toBe('去频道')
    await act(async () => { action.click() })
    expect(openChannels).toHaveBeenCalledTimes(1)
  })

  it('can be closed by hand, and does not come back until the next publish', async () => {
    invoke.mockResolvedValue({ kind: 'accepted', recordId: 'r1', delivery: { state: 'sent-accepted' } })
    render(<Row edition={document()} />)
    await act(async () => { await Promise.resolve() })
    await push()
    expect(strip()).not.toBeNull()
    const close = strip()?.querySelector('button[aria-label="关闭结果条"]') as HTMLButtonElement
    await act(async () => { close.click() })
    expect(strip()).toBeNull()
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
    expect(summaryText()).toBe('只发了文字：通道收到了')
  })
})
