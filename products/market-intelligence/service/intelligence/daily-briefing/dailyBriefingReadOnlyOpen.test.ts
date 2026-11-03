import { describe, expect, it, vi } from 'vitest'

import { dailyBriefingPolicy } from '../../../contracts/dailyBriefing'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { createDailyBriefingService, type DailyBriefingStore, type DailyBriefingStoredEdition } from './dailyBriefingService'

/**
 * Opening the brief is a read.
 *
 * The screen must not disagree with the list, so the read has to answer with the edition that is
 * actually stored for the current issue — including when the reader is inside an issue that has an
 * edition and the page is only refreshing.
 */
const SHANGHAI = 'Asia/Shanghai'
/** 03:47 on 11-04 in Shanghai: still inside the 11-03 issue (cutoff 07:00). */
const AS_OF = '2026-11-03T19:47:00.000Z'
const ISSUE_DATE = '2026-11-03'

const document = (date: string, locale: 'zh-CN' | 'en-US'): DailyBriefingDocument => ({
  schemaVersion: dailyBriefingPolicy.schemaVersion,
  policyVersion: dailyBriefingPolicy.policyVersion,
  edition: { date, locale, generatedAt: `${date}T00:30:00.000Z`, windowStart: `${date}T00:30:00.000Z`, windowEnd: `${date}T00:30:00.000Z`, timeZone: SHANGHAI },
  status: { readings: [], readingsAvailable: 4, readingsTotal: 4 },
  lede: { source: 'template', text: `lede ${locale}`, generatedAt: `${date}T00:30:00.000Z` },
  news: { items: [], macro: [], notes: {} },
  data: { market: [], funds: [], sentiment: { fearGreed: undefined, news: { state: 'available', counts: { bearish: 0, bullish: 0, mixed: 0, neutral: 0 }, itemCount: 0 } } },
  next: { items: [] },
  citations: [],
  provenance: { summaryId: `s-${locale}-${date}`, readAt: `${date}T00:30:00.000Z` }
} as unknown as DailyBriefingDocument)

function storeWith(rows: readonly DailyBriefingStoredEdition[]): DailyBriefingStore {
  return {
    async get(date: string, locale: 'zh-CN' | 'en-US') { return rows.find((row) => row.date === date && row.locale === locale) },
    async put() {},
    async list(from: string, to: string, locale: 'zh-CN' | 'en-US') { return rows.filter((row) => row.locale === locale && row.date >= from && row.date <= to) },
    async prune() {}
  } as unknown as DailyBriefingStore
}

const stored = (locale: 'zh-CN' | 'en-US'): DailyBriefingStoredEdition => ({
  date: ISSUE_DATE,
  locale,
  generatedAt: `${ISSUE_DATE}T00:30:00.000Z`,
  windowStart: `${ISSUE_DATE}T00:30:00.000Z`,
  windowEnd: `${ISSUE_DATE}T00:30:00.000Z`,
  document: document(ISSUE_DATE, locale)
})

describe('daily briefing read-only open', () => {
  it('answers with the stored edition of the current issue, without generating', async () => {
    const readFacts = vi.fn()
    const service = createDailyBriefingService({
      source: { readFacts } as never,
      store: storeWith([stored('zh-CN'), stored('en-US')]),
      now: () => AS_OF
    })

    const today = await service.getToday({ locale: 'zh-CN', timeZone: SHANGHAI, generate: false })

    expect(today.state).toBe('available')
    if (today.state !== 'available') return
    expect(today.document.edition.date).toBe(ISSUE_DATE)
    expect(today.document.edition.locale).toBe('zh-CN')
    expect(readFacts).not.toHaveBeenCalled()
  })

  it('says nothing was written in this language, rather than failing', async () => {
    const service = createDailyBriefingService({
      source: { readFacts: vi.fn() } as never,
      store: storeWith([stored('en-US')]),
      now: () => AS_OF
    })

    const today = await service.getToday({ locale: 'zh-CN', timeZone: SHANGHAI, generate: false })

    expect(today).toMatchObject({ state: 'unavailable', failureCode: 'not-generated' })
  })
})
