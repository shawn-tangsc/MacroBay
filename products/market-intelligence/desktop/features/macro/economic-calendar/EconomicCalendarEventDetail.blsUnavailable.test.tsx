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
  const detail = (overrides: Record<string, unknown> = {}) => ({
    event: event(), now: () => new Date(asOf), onRefresh: vi.fn(async () => undefined),
    onReleaseTimeChanged: async () => undefined, releaseTimeClient: client, text, ...overrides
  })

  it('shows the stop notice and greys the refresh control, which then sends nothing', async () => {
    const onRefresh = vi.fn(async () => undefined)
    const host = await render(detail({ onRefresh, blsUnavailableNotice: notice }) as never)
    // 说明与源注册表同源（调用方传进来的就是由原因码拼出的那一句）。
    expect(host.querySelector('[data-bls-unavailable]')?.textContent).toBe(notice)
    const refresh = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(text.blsRefresh.action))
    expect(refresh).toBeDefined()
    expect(refresh?.disabled).toBe(true)
    await act(async () => { refresh?.click() })
    // 置灰之后点不动，也不发请求。
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('leaves the control usable when the source is not stopped', async () => {
    const onRefresh = vi.fn(async () => undefined)
    const host = await render(detail({ onRefresh, blsUnavailableNotice: undefined }) as never)
    expect(host.querySelector('[data-bls-unavailable]')).toBeNull()
    const refresh = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(text.blsRefresh.action))
    expect(refresh?.disabled).toBe(false)
  })
})
