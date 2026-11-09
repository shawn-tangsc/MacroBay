// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../../shared/i18n/productText'
import { EconomicCalendarEventDetail } from './EconomicCalendarEventDetail'
import type { EconomicCalendarEventView } from './economicCalendarModel'

const text = productText['zh-CN'].pages.intelligence.portal.calendar
const asOf = '2026-11-06T14:00:00.000Z'
const notice = 'BLS 官方日历：当前网络环境无法自动获取（官方站点返回 403），自动同步已停止；库里的 BLS 事件来自上次成功同步（2026-10-22），发布时间未知。'
const blocked = '暂时不能刷新：官方站点拒绝了当前网络。恢复时间未知。'

/** A BLS-eligible row: the refresh control only exists for these families and only before release. */
function event(overrides: Partial<EconomicCalendarEventView> = {}): EconomicCalendarEventView {
  return {
    eventKey: 'US.CPI.RELEASE.2026-M11',
    eventFamily: 'consumer-price-index',
    titleKey: 'cpi',
    periodKey: '2026-M11',
    lifecycleState: 'scheduled',
    coverage: 'available',
    // 自动同步来源的行：它没人工导入过，且发布日已到，才出现那颗刷新键。
    scheduledDate: '2026-11-05',
    scheduledAt: '2026-11-05T13:30:00.000Z',
    releaseTimeSource: 'official',
    detectedAt: asOf,
    caveats: ['bls-python-schedule'],
    category: 'inflation',
    labelKey: 'cpi',
    sources: ['blsAutomaticSchedule'],
    ...overrides
  }
}

const client = {
  setReleaseTime: vi.fn(async () => ({ state: 'saved' as const, scheduledAt: asOf, scheduledDate: '2026-11-06' })),
  clearReleaseTime: vi.fn(async () => ({ state: 'cleared' as const }))
}

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(detail: Parameters<typeof EconomicCalendarEventDetail>[0]) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(
    <ShellTimeZoneProvider timeZone="UTC"><ConfirmProvider><EconomicCalendarEventDetail {...detail} /></ConfirmProvider></ShellTimeZoneProvider>
  ))
  return host
}

describe('the BLS refresh once the official calendar has stopped', () => {
  // 与组件契约逐字段对齐：`refreshState` 是可选的，但漏传时 TypeScript 会在这里把缺字段说出来。
  const detail = (overrides: Record<string, unknown> = {}): Parameters<typeof EconomicCalendarEventDetail>[0] => ({
    event: event(), now: () => new Date(asOf), onRefresh: vi.fn(async () => undefined),
    onReleaseTimeChanged: async () => undefined, releaseTimeClient: client, refreshState: undefined, text, ...overrides
  } as Parameters<typeof EconomicCalendarEventDetail>[0])

  it('shows the stop notice and greys the refresh control, which then sends nothing', async () => {
    const onRefresh = vi.fn(async () => undefined)
    const host = await render(detail({ onRefresh, blsUnavailableNotice: notice }))
    // 说明与源注册表同源（调用方传进来的就是由原因码拼出的那一句）。
    expect(host.querySelector('[data-bls-unavailable]')?.textContent).toBe(notice)
    const refresh = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(text.blsRefresh.action))
    expect(refresh).toBeDefined()
    expect(refresh?.disabled).toBe(true)
    await act(async () => { refresh?.click() })
    // 置灰之后点不动，也不发请求。
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('says inline why the control cannot be used and keeps the reason code behind one info trigger', async () => {
    // 界面设计 2026-11-09：置灰必须当场说清「为什么不能刷新、什么时候能好（若有）」。
    // 2026-11-10 收紧：正文只给读者说法，**完整原因码不进正文**——它在那一格自己的 ⓘ 里，默认收起、恰一处。
    const host = await render(detail({
      blsUnavailableNotice: notice,
      blsRefreshBlocked: blocked,
      blsRefreshBlockedCode: 'official-endpoint-returned-403'
    }))
    const inline = host.querySelector('[data-bls-refresh-blocked]')
    expect(inline, 'the greyed key carries its own reason').not.toBeNull()
    expect(inline?.textContent).toContain('恢复时间未知')
    expect(inline?.textContent).not.toContain('official-endpoint-returned-403')
    // 与刷新键同处一个行内容器（同一行），而不是另起一段。
    expect(inline?.parentElement?.querySelector('button')?.textContent).toContain(text.blsRefresh.action)
    // 同一件事只出现一次。
    expect(host.querySelectorAll('[data-bls-refresh-blocked]')).toHaveLength(1)

    // 码在 ⓘ 里、恰一处，而且默认不展开：没打开时整页读不到这个码。
    const triggers = [...host.querySelectorAll<HTMLElement>(`[aria-label="${text.blsRefresh.reasonCodeAria}"]`)]
    expect(triggers).toHaveLength(1)
    expect(document.body.textContent).not.toContain('official-endpoint-returned-403')
    await act(async () => { triggers[0]!.focus() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(document.body.textContent).toContain('official-endpoint-returned-403')
  })

  it('leaves the control usable when the source is not stopped', async () => {
    const onRefresh = vi.fn(async () => undefined)
    const host = await render(detail({ onRefresh, blsUnavailableNotice: undefined, blsRefreshBlocked: undefined }))
    expect(host.querySelector('[data-bls-unavailable]')).toBeNull()
    expect(host.querySelector('[data-bls-refresh-blocked]')).toBeNull()
    const refresh = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(text.blsRefresh.action))
    expect(refresh?.disabled).toBe(false)
  })
})
