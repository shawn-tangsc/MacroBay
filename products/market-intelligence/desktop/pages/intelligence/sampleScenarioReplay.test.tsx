// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { loadSampleModeCatalog } from '../../../service/demo/demoCatalog'
import { createSampleModeSession } from '../../../service/demo/demoSession'
import { createCrossAssetObservationClient } from '../../shared/ipc/crossAssetObservationClient'
import { intelligenceCapitalConditionsClient } from '../../shared/ipc/intelligenceCapitalConditionsClient'
import { intelligenceFearGreedClient } from '../../shared/ipc/intelligenceFearGreedClient'
import { intelligenceFundingRateHistoryClient } from '../../shared/ipc/intelligenceFundingRateHistoryClient'
import { macroEconomicCalendarClient } from '../../shared/ipc/macroEconomicCalendarClient'
import { marketCalendarClient } from '../../shared/ipc/marketCalendarClient'
import { createMacroMarketSnapshotClient } from '../../shared/ipc/macroMarketSnapshotClient'
import { createMacroRatesSnapshotClient } from '../../shared/ipc/macroRatesSnapshotClient'
import { marketAnalysisTimelineClient } from '../../shared/ipc/marketAnalysisTimelineClient'
import { newsSentimentClient } from '../../shared/ipc/newsSentimentClient'

/**
 * 示例场景的离线回放测试：用主进程同一套覆盖层、同一份场景数据，去喂真实的渲染层客户端。
 *
 * 它的价值在于「契约不匹配在 CI 里就红」——否则每次都要人重启应用、肉眼找空白面板。
 * 场景数据缺失或被改坏时，这里会指名道姓地说出是哪个面。
 */
async function replay(locale: 'zh-CN' | 'en-US' = 'zh-CN'): Promise<void> {
  const session = createSampleModeSession({
    productId: 'market-intelligence',
    loadCatalog: loadSampleModeCatalog,
    getLanguage: async () => locale,
    jobs: { listSchedules: () => [], removeSchedule: () => undefined, listRuns: () => [], cancel: () => undefined },
    resumeWork: async () => undefined
  })
  const entered = await session.enter()
  expect(entered.active, `scenario did not enter: ${entered.unavailableReason ?? 'unknown'}`).toBe(true)
  vi.stubGlobal('window', {
    platform: {
      products: {
        invoke: async (_productId: string, method: string, payload: unknown) => {
          const served = session.lookup(method, payload)
          if (served === undefined) throw new Error(`demo-surface-missing:${method}`)
          return served
        }
      }
    }
  })
}

describe('示例场景回放', () => {
  it('answers every dashboard read the page actually makes', async () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      await replay(locale)

      const fearGreed = await intelligenceFearGreedClient.querySnapshot({ asOf: '2026-10-27T09:50:00.000Z' })
      expect(fearGreed, `${locale} fear-greed`).toMatchObject({ state: 'available' })

      const funding = await intelligenceFundingRateHistoryClient.query({ asOf: '2026-10-27T09:50:00.000Z' })
      expect(funding, `${locale} funding`).toMatchObject({ state: 'available' })

      const capital = await intelligenceCapitalConditionsClient.querySnapshot({ asOf: '2026-10-27T09:50:00.000Z' })
      expect(capital, `${locale} capital`).toMatchObject({ state: 'available' })

      const market = await createMacroMarketSnapshotClient().query({ asOf: '2026-10-27T09:50:00.000Z' } as never)
      expect(market, `${locale} macro market`).toMatchObject({ state: 'available' })

      const rates = await createMacroRatesSnapshotClient().query({ asOf: '2026-10-27T09:50:00.000Z' } as never)
      expect(rates, `${locale} macro rates`).toMatchObject({ state: 'available' })

      const calendar = await macroEconomicCalendarClient.queryMonth({ month: '2026-10', asOf: '2026-10-27T09:50:00.000Z' } as never)
      expect(calendar, `${locale} calendar`).toMatchObject({ state: 'available' })

      const marketCalendar = await marketCalendarClient.queryMonth({ month: '2026-10', locale: locale === 'en-US' ? 'en' : 'zh', asOf: '2026-10-27T09:50:00.000Z' })
      expect(marketCalendar, `${locale} market calendar`).toMatchObject({ state: 'available' })

      const sentiment = await newsSentimentClient.query({ asOf: '2026-10-27T09:50:00.000Z', window: 'all', limit: 20 } as never)
      expect(sentiment, `${locale} news sentiment`).toBeDefined()

      const timeline = await marketAnalysisTimelineClient.listTimeline({})
      expect(timeline, `${locale} timeline`).toMatchObject({ state: 'available' })
      const entry = timeline.state === 'available' ? timeline.page.items[0] : undefined
      expect(entry, `${locale} timeline entry`).toBeDefined()
      const detail = await marketAnalysisTimelineClient.getDetail(entry!)
      expect(detail, `${locale} analysis detail`).toMatchObject({ state: 'available' })
    }
  })

  it('answers the cross-asset panel, lease included', async () => {
    await replay('zh-CN')
    const client = createCrossAssetObservationClient()
    const lease = await client.acquire()
    expect(lease).toMatchObject({ state: 'active' })
    for (const range of ['1h', '24h', '7d'] as const) {
      const snapshot = await client.query({ range })
      expect(snapshot, `cross asset ${range}`).toMatchObject({ schemaVersion: 1, range })
    }
  })
})
