// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { StrictMode } from 'react'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellInstant } from '@platform/ui/time/shellTimeFormat'
import { productText } from '../../../shared/i18n/productText'
import { CalendarEventInterpretation, type CalendarInterpretationClient } from './CalendarEventInterpretation'

/**
 * 解读块的四个状态（R36 #34 第二半，界面设计 2026-11-25 要求补）。
 *
 * 这些用例钉的是**成本与形态**，不是措辞：
 * - 先读、只有「没有这一份数据的解读」才请求，且**只请求一次**；
 * - 有正文时标题/正文/生成时刻/依据范围四样都在；
 * - 失败只给一句原因 + 重试键，**不再自动请求**（自动重试会在后台反复烧调用）；
 * - 这一档不生成（`not-applicable`）或还没生成（`absent` 且请求也没结果）时**整块不渲染**。
 */
const text = productText['zh-CN'].pages.intelligence.portal.calendar
const scoped = (node: React.ReactElement): React.ReactElement => <ShellTimeZoneProvider timeZone="UTC">{node}</ShellTimeZoneProvider>
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

it('⑤ 依据范围：不认识的项丢掉；三项全认不出写兜底句；空数组整行不显示', async () => {
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
  // 空数组＝「没有依据可说」，不是「读不懂」：不拿兜底句顶上，整行不画。
  expect(noScope.querySelector('[data-interpretation-meta]')).toBeNull()
})

it('⑥ 单飞：第一条的请求还没回来就关掉再打开（StrictMode / 快速重开同一种），只请求一次', async () => {
  let release: ((view: View) => void) | undefined
  const read = vi.fn(async () => ({ state: 'absent' as const }))
  const request = vi.fn(() => new Promise<View>((resolve) => { release = resolve }))
  const client = { readEventInterpretation: read, requestEventInterpretation: request } as CalendarInterpretationClient
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const element = scoped(<CalendarEventInterpretation eventKey="US.CPI.RELEASE.2026-M10" text={text} client={client} />)
  await act(async () => root!.render(<StrictMode>{element}</StrictMode>))
  // 请求在飞时卸载再挂载：没有按事件去重的话，这里会发出第二次模型调用。
  await act(async () => root!.unmount())
  root = createRoot(host)
  await act(async () => root!.render(<StrictMode>{element}</StrictMode>))
  expect(request).toHaveBeenCalledTimes(1)
  await act(async () => { release?.(readyView); await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(host.querySelector('[data-calendar-interpretation]')).not.toBeNull()
})

it('③ 失败：一句原因（未知码落到通用句）+ 重试键，且不再自动请求；点重试才请求一次', async () => {
  const fake = client({ read: () => ({ state: 'failed', failureCode: 'some-new-code' }) })
  const host = await render(fake.client)
  expect(fake.request).not.toHaveBeenCalled()
  const failed = host.querySelector('[data-calendar-interpretation-failed]')
  expect(failed?.textContent).toContain(text.interpretation.unavailable)
  // 容器与句子各有自己的类：句子紧贴重试键是界面设计驳回过的形态。
  expect(failed?.classList.contains('mi-calendar-interpretation__failed')).toBe(true)
  const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/features/macro/economic-calendar/economicCalendar.css'), 'utf8')
  expect(css).toMatch(/\.mi-calendar-interpretation__failed\s*\{[^}]*display:\s*grid[^}]*gap:\s*6px/)
  // 失败句替代的是正文那一槽：字号不许掉到 --font-meta。
  expect(css).toMatch(/\.mi-calendar-interpretation__failure\s*\{[^}]*font-size:\s*var\(--font-body\)[^}]*line-height:\s*var\(--line-body\)/)
  const retryButton = [...host.querySelectorAll('button')].find((button) => button.textContent === text.interpretation.retry)
  expect(retryButton).toBeDefined()
  await act(async () => { retryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(fake.request).toHaveBeenCalledTimes(1)
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