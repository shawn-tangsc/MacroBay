// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { dashboardFeedStatusPublicPolicy } from '../../../contracts/macro/dashboardFeedStatusContracts'

const asOf = '2026-08-05T00:00:00.000Z'

const { reading } = vi.hoisted(() => {
  const value: PolicyPathReading = {
    meetingDate: '2027-01-27', daysUntilMeeting: 50, hasProjectionMaterials: false,
    phase: { kind: 'settlement', minutesSinceDecision: 42 },
    settlement: {
      decidedMeetingDate: '2026-12-09',
      previousTargetRange: { lowerPercent: 3.75, upperPercent: 4 },
      actualOutcome: 'hike-25',
      priced: 0.38,
      pricedOutcome: 'no-change',
      pricingBasis: 'pre-decision',
      conclusion: { kind: 'relative', direction: 'hawkish', surprisePp: 62 },
      pricedDistribution: { 'no-change': 0.59, 'hike-25': 0.38, 'hike-50-plus': 0.01, 'cut-25': 0.01, 'cut-50-plus': 0.01 },
      nextMeeting: { meetingDate: '2027-01-27', daysUntil: 50 }
    },
    targetRange: { lowerPercent: 4, upperPercent: 4.25 },
    lastDecision: {
      vote: { for: 9, against: 3 },
      statementUrl: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261209a.htm'
    },
    staleness: 'unavailable'
  }
  return { reading: value }
})

vi.mock('../../shared/ipc/policyPathClient', () => ({
  policyPathClient: { read: async () => ({ state: 'available', asOf: '2026-08-05T00:00:00.000Z', reading }) }
}))

/** 全部源都启用：政策路径那两格（利率 / 美联储日程）也要有各自的源，缺一个就会读不到。 */
const allSourcesEnabled = {
  query: async () => ({
    state: 'available' as const,
    sources: dashboardFeedStatusPublicPolicy.sourceIds.map(sourceId => ({ sourceId, enabled: true, hasCredential: true }))
  })
}

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
  document.body.replaceChildren()
})

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

async function mountWithCalendarOpen(): Promise<void> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(CryptoIntelligenceDashboard, {
    client: { queryMonth: async () => ({ state: 'available' as const, asOf, events: [] }) },
    fundingRateClient: { query: async () => ({ state: 'empty' as const, asOf }) },
    openInterestClient: { query: async () => ({ state: 'empty' as const, asOf, window: '7d' as const }) },
    now: () => new Date(asOf),
    onConfigureSources: () => undefined, onManageSource: () => undefined,
    // 序号加一 = 页面层点了日历入口；抽屉打开后不再关，政策抽屉要叠在它上面。
    openIndicatorDrawerRequest: { seq: 1 },
    calendarEventTitles: { cpi: 'CPI' },
    readCalendarMonth: async () => ({ events: [] as never, sources: [] }),
    dashboardFeedStatusClient: allSourcesEnabled,
    cellEnabledIo: { read: async () => ({}) },
    text: productText['zh-CN'].pages.intelligence.portal.dashboard
  } as never)))
  for (let round = 0; round < 30; round += 1) {
    if (document.querySelector('.mi-policy-card__open') !== null) break
    await flush()
  }
}

describe('policy drawer stacked over the calendar drawer', () => {
  it('keeps the calendar drawer open, stacks the policy drawer above it, and closes only the top on Escape', async () => {
    await mountWithCalendarOpen()
    const detail = document.querySelector<HTMLButtonElement>('.mi-policy-card__open')
    expect(detail).not.toBeNull()
    // ① 不开走另一层：打开政策抽屉时日历抽屉仍在。
    await act(async () => detail!.click())
    await flush()
    expect(document.querySelector('.mk-minical')).not.toBeNull()
    const policy = document.querySelector('aside.mi-analysis-drawer--overlay')
    expect(policy).not.toBeNull()
    // ② 层级是量出来的：政策层（--layer-modal-top）高于平台 drawer 的 1000。
    const style = document.createElement('style')
    style.textContent = [
      readFileSync('platform/ui/tokens/tokens.css', 'utf8'),
      readFileSync('products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css', 'utf8')
    ].join('\n')
    document.head.append(style)
    try {
      expect(Number(getComputedStyle(policy!).zIndex)).toBeGreaterThan(1000)
    } finally {
      style.remove()
    }
    // ③ Esc 只关最上层：政策关、日历仍开；焦点回到「详情」那颗按钮。
    await act(async () => { policy!.querySelector('button')?.focus() })
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    await flush()
    expect(document.querySelector('aside.mi-analysis-drawer--overlay')).toBeNull()
    expect(document.querySelector('.mk-minical')).not.toBeNull()
    expect(document.activeElement).toBe(detail)
  })
})
