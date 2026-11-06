import { describe, expect, it } from 'vitest'

import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import { posterProps } from './dailyBriefingPoster'

/**
 * 导出图的设计句跟**这一版**走（`A0.12` 之后一天可以多期）：期号不参与匹配，就会拿同一天另一期
 * 的"应有语言"去判这一版缺了什么，导出图上会多一句不该有的说明。
 */
const document = (periodId: string): DailyBriefingDocument => ({
  schemaVersion: 15,
  policyVersion: 'daily-briefing.v24',
  edition: {
    date: '2026-11-05', locale: 'zh-CN', periodId, generatedAt: '2026-11-05T00:00:00.000Z',
    windowStart: '2026-11-04T00:00:00.000Z', windowEnd: '2026-11-05T00:00:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: { readings: [], readingsAvailable: 4, readingsTotal: 4 },
  lede: { source: 'template', text: '', generatedAt: '2026-11-05T00:00:00.000Z' },
  news: { items: [], macro: [], notes: {} },
  data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty', counts: { bearish: 0, bullish: 0, mixed: 0, neutral: 0 }, itemCount: 0 } } },
  conclusion: undefined as never,
  next: { items: [] },
  citations: [],
  provenance: { summaryId: '', readAt: '2026-11-05T00:00:00.000Z' }
} as unknown as DailyBriefingDocument)

const row = (periodId: string, expectedLocales: readonly ('zh-CN' | 'en-US')[]): DailyBriefingEditionSummary => ({
  date: '2026-11-05', periodId, locale: 'zh-CN', availableLocales: ['zh-CN'], expectedLocales,
  state: 'generated', generatedAt: '2026-11-05T00:00:00.000Z'
})

describe('the export note follows the issue on screen, not the first row of that day', () => {
  it('uses the matching issue’s expectation, so another issue’s missing language is not reported', () => {
    const props = posterProps({
      document: document('period_b'),
      editions: [row('period_a', ['zh-CN', 'en-US']), row('period_b', ['zh-CN'])],
      fallbackText: productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
    })
    // A 期应有英文、B 期只有中文：这一版是 B，导出图上不该出现"缺英文"的说明。
    expect(props.completenessNote ?? '').not.toContain('英文')
  })
})
