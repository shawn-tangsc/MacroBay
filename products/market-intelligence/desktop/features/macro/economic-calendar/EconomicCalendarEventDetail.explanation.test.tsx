// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'
import { EconomicCalendarEventDetail } from './EconomicCalendarEventDetail'
import type { EconomicCalendarEventView } from './economicCalendarModel'

/**
 * 官方详情的「事件说明」（R36 #34）。官方四个源的标题键是另一套身份，产品定了接到同一段文案：
 * **只对 `(titleKey, US)` 生效**，未列标题键与 `unknown` 一律整段不出现。
 */
const text = productText['zh-CN'].pages.intelligence.portal.calendar
const asOf = '2026-11-06T14:00:00.000Z'

function event(overrides: Partial<EconomicCalendarEventView> = {}): EconomicCalendarEventView {
  return {
    eventKey: 'US.CPI.RELEASE.2026-M10', eventFamily: 'consumer-price-index', titleKey: 'cpi',
    countryCode: 'US', periodKey: '2026-M10', lifecycleState: 'released', coverage: 'available',
    scheduledDate: '2026-11-13', scheduledAt: '2026-11-13T13:30:00.000Z', releaseTimeSource: 'official',
    detectedAt: asOf, actual: { displayValue: '3.2%' }, previous: { displayValue: '3.0%' }, caveats: [],
    category: 'inflation', labelKey: 'cpi', sources: ['blsManualIcs'],
    ...overrides
  }
}

const client = {
  setReleaseTime: vi.fn(async () => ({ state: 'saved' as const, scheduledAt: asOf, scheduledDate: '2026-11-13' })),
  clearReleaseTime: vi.fn(async () => ({ state: 'cleared' as const }))
}

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function renderHost(
  target: EconomicCalendarEventView,
  interpretationClient?: Parameters<typeof EconomicCalendarEventDetail>[0]['interpretationClient']
): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(
    <ShellTimeZoneProvider timeZone="UTC"><ConfirmProvider>
      <EconomicCalendarEventDetail
        event={target} now={() => new Date(asOf)} onRefresh={async () => undefined}
        onReleaseTimeChanged={async () => undefined} releaseTimeClient={client} refreshState={undefined} text={text}
        officialConsensus={null} linkedConsensus={undefined}
        {...(interpretationClient === undefined ? {} : { interpretationClient })}
      />
    </ConfirmProvider></ShellTimeZoneProvider>
  ))
  // 解读是打开后异步读/生成的：把 effect 里的 promise 链走完，断言才看得到结果。
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

it('官方 CPI 行：三段说明逐字出现，与市场那条 CPI 读同一段', async () => {
  const host = await renderHost(event())
  const paragraphs = [...host.querySelectorAll('[data-calendar-explanation] p')].map((node) => node.textContent)
  expect(paragraphs).toEqual([text.explanations.cpi.what, text.explanations.cpi.why, text.explanations.cpi.watch])
  // 与市场抽屉同一条理由：宿主 `<aside>` 是 aria-live="polite"，静态参考不该随选择播报。
  expect(host.querySelector('[data-calendar-explanation]')?.getAttribute('aria-live')).toBe('off')
})

it('未列标题键：整段不出现，也不拿名字里带 cpi 的那段顶上', async () => {
  const host = await renderHost(event({ titleKey: 'retail-sales', labelKey: 'unknown', category: 'consumption' }))
  expect(host.querySelector('[data-calendar-explanation]')).toBeNull()
  expect(host.textContent).not.toContain(text.explanations.cpi.what)
})

it('unknown 标题键（讲话、会议）：没有说明', async () => {
  const host = await renderHost(event({ titleKey: 'unknown', labelKey: 'unknown', eventFamily: 'fomc' }))
  expect(host.querySelector('[data-calendar-explanation]')).toBeNull()
})

/** 假的解读口：只会答「是什么」，不连模型。 */
function interpretationClient(overrides: Readonly<{
  read?: () => { state: 'ready'; text: string; generatedAt: string; evidenceScope: readonly string[] } | { state: 'not-applicable' } | { state: 'absent' }
  request?: () => { state: 'ready'; text: string; generatedAt: string; evidenceScope: readonly string[] } | { state: 'failed'; failureCode: string }
}> = {}) {
  const read = vi.fn(async () => overrides.read?.() ?? { state: 'absent' as const })
  const request = vi.fn(async () => overrides.request?.() ?? { state: 'not-applicable' as const })
  return { client: { readEventInterpretation: read, requestEventInterpretation: request }, read, request }
}

const MODEL_TEXT = '美国 10 月 CPI 年率 3.2%，高于预期的 3.1%；下一期继续看核心分项的方向。'

it('说明与解读是两块：说明逐字不变，解读带生成时刻与依据范围，互换即红', async () => {
  const fake = interpretationClient({ read: () => ({ state: 'ready', text: MODEL_TEXT, generatedAt: asOf, evidenceScope: ['event', 'actual', 'consensus'] }) })
  const host = await renderHost(event(), fake.client)
  // 固定说明仍是那三段，一个字没变。
  expect([...host.querySelectorAll('[data-calendar-explanation] p')].map((node) => node.textContent))
    .toEqual([text.explanations.cpi.what, text.explanations.cpi.why, text.explanations.cpi.watch])
  // 解读是另一块，正文是模型那段，并带生成时刻与依据范围。
  const interpretation = host.querySelector('[data-calendar-interpretation]')
  expect(interpretation?.querySelector('[data-interpretation-text]')?.textContent).toBe(MODEL_TEXT)
  const meta = interpretation?.querySelector('[data-interpretation-meta]')?.textContent ?? ''
  expect(meta).toContain('生成于')
  expect(meta).toContain('依据')
  expect(meta).toContain('实际值') // 依据范围把用到的项列出来
  // 互不顶替：说明那块里没有模型那句话，解读这块里没有固定说明的句子。
  expect(host.querySelector('[data-calendar-explanation]')?.textContent).not.toContain(MODEL_TEXT)
  expect(interpretation?.textContent).not.toContain(text.explanations.cpi.what)
  // 已生成时不再请求一次（读到的就是这份数据的解读）。
  expect(fake.request).not.toHaveBeenCalled()
})

it('低档与未分级：解读整块不出现，也不发起生成（服务侧说 not-applicable）', async () => {
  const fake = interpretationClient({ read: () => ({ state: 'not-applicable' }) })
  const host = await renderHost(event(), fake.client)
  expect(host.querySelector('[data-calendar-interpretation]')).toBeNull()
  expect(host.querySelector('[data-calendar-interpretation-failed]')).toBeNull()
  expect(fake.read).toHaveBeenCalledTimes(1)
  // 没有请求＝没有花模型调用：这是「低档不生成」在界面这一侧的唯一判据。
  expect(fake.request).not.toHaveBeenCalled()
  // 固定说明不受影响：低档事件只要登记过族，说明照样在。
  expect(host.querySelector('[data-calendar-explanation]')).not.toBeNull()
})