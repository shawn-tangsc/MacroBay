// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { StrictMode } from 'react'
import { ConfigProvider } from 'antd'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'
import { formatShellInstant } from '@platform/ui/time/shellTimeFormat'
import { productText } from '../../../shared/i18n/productText'
import { CalendarEventInterpretation, type CalendarInterpretationClient } from './CalendarEventInterpretation'

/**
 * 解读块的四个状态（R36 #34 第二半，界面设计 2026-11-25 要求补）。
 *
 * 这些用例钉的是**成本与形态**，不是措辞：
 * - 先读、只有「没有这一份数据的解读」才请求，且**只请求一次**；
 * - 有正文时标题/正文/生成时刻/依据范围四样都在（空依据只留时刻）；
 * - 失败只给一句原因 + **一个**按钮，**不再自动请求**（自动重试会在后台反复烧调用）；
 *   读失败与生成失败是两件事：前者「暂时读不到这条解读」+「重试」（重读，不花钱），
 *   后者「模型这次没有回答」+「重新生成」；
 * - 这一档不生成（`not-applicable`）或还没生成（`absent` 且请求也没结果）时**整块不渲染**。
 */
const text = productText['zh-CN'].pages.intelligence.portal.calendar
// 真机里窗口的 ConfigProvider 统一关掉「两个汉字之间插空格」；测试沿用同一份配置，否则两字按钮
// 的可见文案会读成「重 试」，与产品给的「重试」对不上。
const scoped = (node: React.ReactElement): React.ReactElement => (
  <ConfigProvider button={WINDOW_ANTD_BUTTON_CONFIG}>
    <ShellTimeZoneProvider timeZone="UTC">{node}</ShellTimeZoneProvider>
  </ConfigProvider>
)
const generatedAt = '2026-11-13T14:00:00.000Z'

type Ready = { state: 'ready'; text: string; generatedAt: string; evidenceScope: readonly string[] }
type View = Ready | { state: 'not-applicable' } | { state: 'absent' } | { state: 'failed'; failureCode: string }

function client(overrides: Readonly<{ read: () => View; request?: () => View }>) {
  const read = vi.fn(async () => overrides.read())
  const request = vi.fn(async () => overrides.request?.() ?? ({ state: 'not-applicable' } as View))
  return { client: { readEventInterpretation: read, requestEventInterpretation: request } as CalendarInterpretationClient, read, request }
}

const MODEL_TEXT = '美国 10 月 CPI 年率 3.2%，高于预期；下一期继续看核心分项。'
const readyView: Ready = { state: 'ready', text: MODEL_TEXT, generatedAt, evidenceScope: ['event', 'actual', 'consensus'] }

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(fake: CalendarInterpretationClient): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(scoped(
    <CalendarEventInterpretation eventKey="US.CPI.RELEASE.2026-M10" text={text} client={fake} />
  )))
  // effect 里的 promise 链走完再断言。
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

it('① 先读；只有 absent 才请求，且只请求一次', async () => {
  const absent = client({ read: () => ({ state: 'absent' }), request: () => readyView })
  const host = await render(absent.client)
  expect(absent.read).toHaveBeenCalledTimes(1)
  expect(absent.request).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[data-calendar-interpretation]')).not.toBeNull()

  document.body.replaceChildren()
  await act(async () => root?.unmount())
  root = null
  const cached = client({ read: () => readyView })
  await render(cached.client)
  // 已经有这一份数据的解读：不请求、不花调用。
  expect(cached.request).not.toHaveBeenCalled()
})

it('② 有正文：标题、正文、生成时刻、依据范围四样都在，meta 走一条模板键', async () => {
  const host = await render(client({ read: () => readyView }).client)
  const block = host.querySelector('[data-calendar-interpretation]')
  expect(block?.querySelector('h3')?.textContent).toBe(text.interpretation.title)
  expect(block?.querySelector('[data-interpretation-text]')?.textContent).toBe(MODEL_TEXT)
  const meta = block?.querySelector('[data-interpretation-meta]')?.textContent ?? ''
  // 模板键只填两个占位；标点在文案表里，不在代码里。
  expect(meta).toContain('生成于')
  expect(meta).toContain('依据')
  expect(meta).toContain('实际值')
  expect(meta).not.toBe(text.interpretation.meta)
  // 生成时刻必须真的是这一条的时刻：与 `useShellTimeFormat` 同源（UTC · zh-CN · 分钟）。
  expect(meta).toContain(formatShellInstant(generatedAt, { timeZone: 'UTC', locale: 'zh-CN', precision: 'minute' }))
  // 静态参考，不进播报：宿主 aside 是 aria-live="polite"，这一块要自己关掉。
  expect(block?.getAttribute('aria-live')).toBe('off')
})

it('⑤ 依据范围：不认识的项丢掉；三项全认不出写兜底句；空数组只留时刻、不画「依据」', async () => {
  const oneUnknown = await render(client({ read: () => ({ ...readyView, evidenceScope: ['event', 'something-new'] }) }).client)
  const meta = oneUnknown.querySelector('[data-interpretation-meta]')?.textContent ?? ''
  expect(meta).not.toContain('something-new')
  expect(meta).toContain('这条发布') // 认识的项照常印

  document.body.replaceChildren()
  await act(async () => root?.unmount())
  root = null
  const allUnknown = await render(client({ read: () => ({ ...readyView, evidenceScope: ['a', 'b', 'c'] }) }).client)
  expect(allUnknown.querySelector('[data-interpretation-meta]')?.textContent).toContain(text.interpretation.basisFallback)

  document.body.replaceChildren()
  await act(async () => root?.unmount())
  root = null
  const noScope = await render(client({ read: () => ({ ...readyView, evidenceScope: [] }) }).client)
  // 空数组＝「没有依据可说」，不是「读不懂」：不拿兜底句顶上；但**时刻要留**——
  // 读者靠它判断这段新旧、区分模型文字与固定说明，所以换 metaTime 那一行，不是整行不画。
  const noScopeMeta = noScope.querySelector('[data-interpretation-meta]')?.textContent ?? ''
  expect(noScopeMeta).toContain(formatShellInstant(generatedAt, { timeZone: 'UTC', locale: 'zh-CN', precision: 'minute' }))
  expect(noScopeMeta).not.toContain('依据')
  expect(noScopeMeta).not.toContain(text.interpretation.basisFallback)
})

it('⑥ 单飞：第一条请求在飞时重开（与 StrictMode 第二次 effect 同一条路径）只请求一次', async () => {
  let release: ((view: View) => void) | undefined
  const read = vi.fn(async () => ({ state: 'absent' as const }))
  const request = vi.fn(() => new Promise<View>((resolve) => { release = resolve }))
  const client = { readEventInterpretation: read, requestEventInterpretation: request } as CalendarInterpretationClient
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const element = scoped(<CalendarEventInterpretation eventKey="US.CPI.RELEASE.2026-M10" text={text} client={client} />)
  await act(async () => root!.render(<StrictMode>{element}</StrictMode>))
  // 重开（卸载再挂载）与 StrictMode 的第二次 effect 走的是同一条路径：第二次挂载命中在飞表，
  // 不会发出第二次模型调用。StrictMode 的双调用是 React dev 构建的行为，与 DOM 实现无关（happy-dom 一样）。
  await act(async () => root!.unmount())
  root = createRoot(host)
  await act(async () => root!.render(<StrictMode>{element}</StrictMode>))
  expect(request).toHaveBeenCalledTimes(1)
  await act(async () => { release?.(readyView); await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(host.querySelector('[data-calendar-interpretation]')).not.toBeNull()
})

it('③ 生成失败：一句模型侧原因 + 只出「重新生成」，不再自动请求；点它才请求一次', async () => {
  const fake = client({ read: () => ({ state: 'failed', failureCode: 'some-new-code' }) })
  const host = await render(fake.client)
  expect(fake.request).not.toHaveBeenCalled()
  const failed = host.querySelector('[data-calendar-interpretation-failed]')
  expect(failed?.textContent).toContain(text.interpretation.unavailable)
  // 容器与句子各有自己的类：句子紧贴重试键是界面设计驳回过的形态。
  expect(failed?.classList.contains('mi-calendar-interpretation__failed')).toBe(true)
  const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css'), 'utf8')
  expect(css).toMatch(/\.mi-calendar-interpretation__failed\s*\{[^}]*display:\s*grid[^}]*gap:\s*6px/)
  // grid 子项默认 stretch，会把 antd 的按钮拉满整行（界面设计量过 420 宽容器 → 按钮 420）。
  expect(css).toMatch(/\.mi-calendar-interpretation__failed\s*\{[^}]*justify-items:\s*start/)
  // 失败句替代的是正文那一槽：字号不许掉到 --font-meta。
  expect(css).toMatch(/\.mi-calendar-interpretation__failure\s*\{[^}]*font-size:\s*var\(--font-body\)[^}]*line-height:\s*var\(--line-body\)/)
  // 一个档位只出一个按钮：生成失败是「重新生成」，不许和读失败的「重试」并排。
  const buttons = [...host.querySelectorAll('button')].map((button) => button.textContent)
  expect(buttons).toEqual([text.interpretation.retry])
  await act(async () => { [...host.querySelectorAll('button')][0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(fake.request).toHaveBeenCalledTimes(1)
})

it('③b 读失败：不说成「模型没回答」，只出「重试」，点了也只是重读、不再问模型', async () => {
  const read = vi.fn(async (): Promise<View> => { throw new Error('ipc read failed') })
  const request = vi.fn(async () => readyView)
  const host = await render({ readEventInterpretation: read, requestEventInterpretation: request } as CalendarInterpretationClient)
  const failed = host.querySelector('[data-calendar-interpretation-failed]')
  // 本地读失败：句子是「暂时读不到这条解读」，不是「模型这次没有回答」——我们根本没问过模型。
  expect(failed?.textContent).toContain(text.interpretation.failure['read-failed'])
  expect(failed?.textContent).not.toContain(text.interpretation.failure['provider-error'])
  const buttons = [...host.querySelectorAll('button')].map((button) => button.textContent)
  expect(buttons).toEqual([text.interpretation.retryRead])
  expect(request).not.toHaveBeenCalled()
  // 「重试」= 重读一次，不花钱：再点也只增加读次数，不产生模型调用。
  await act(async () => { [...host.querySelectorAll('button')][0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(read).toHaveBeenCalledTimes(2)
  expect(request).not.toHaveBeenCalled()
})

it('④ not-applicable 与 absent（请求也没结果）：整块不渲染', async () => {
  const host = await render(client({ read: () => ({ state: 'not-applicable' }) }).client)
  expect(host.querySelector('[data-calendar-interpretation]')).toBeNull()
  expect(host.querySelector('[data-calendar-interpretation-failed]')).toBeNull()
  expect(host.textContent).toBe('')

  document.body.replaceChildren()
  await act(async () => root?.unmount())
  root = null
  const host2 = await render(client({ read: () => ({ state: 'absent' }) }).client) // request 默认 not-applicable
  expect(host2.textContent).toBe('')
})