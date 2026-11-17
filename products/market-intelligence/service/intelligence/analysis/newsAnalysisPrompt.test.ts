import { expect, it } from 'vitest'

import type { EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { buildNewsAnalysisMessages } from './newsAnalysisPrompt'

/**
 * 新闻线提示词的「读者可见」约束：校验判不了的东西（偏向用词、缺口时不给方向）只能写在提示词里，
 * 所以这里断在**产出**上——把要求写进提示词，并且不随时间悄悄丢掉。
 */
const asOf = '2026-11-17T12:00:00.000Z'

function snapshot(): EvidenceSnapshot {
  return {
    id: 'mi-es-1', schemaVersion: 3, eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf, snapshotHash: 'h1',
    profileId: 'crypto-market-analysis-v1',
    facts: [
      { factId: 'triggered-news:item-1', evidenceRefId: 'news:item-1', domain: 'sentiment', subject: 'BTC', metric: 'news-sentiment', value: 'bearish · strength 3/5｜title｜quote', unit: null, sourceId: 'source', sourceLabel: '源', observedAt: asOf, asOf, freshness: 'fresh', confidence: 0.8, comparability: 'not-comparable' },
      { factId: 'fact-A', evidenceRefId: 'ev-A', domain: 'capital', subject: 'BTC', metric: 'etf-net-flow-usd', value: -2.92, unit: 'percent', sourceId: 'source', sourceLabel: '源', observedAt: '2026-11-17T11:30:00.000Z', asOf, freshness: 'fresh', confidence: 1, comparability: 'comparable' }
    ],
    evidenceRefs: [
      { evidenceRefId: 'news:item-1', sourceId: 'source', sourceLabel: '源', itemId: 'item-1', occurredAt: asOf, publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf, excerptHash: 'h' },
      { evidenceRefId: 'ev-A', sourceId: 'source', sourceLabel: '源', itemId: null, occurredAt: asOf, publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf, excerptHash: 'h' }
    ],
    missingDomains: [], caveats: [], sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1',
    trigger: { source: 'intelligence-item', itemId: 'item-1', factId: 'triggered-news:item-1', evidenceRefId: 'news:item-1' }
  } as EvidenceSnapshot
}

function messages() {
  return buildNewsAnalysisMessages(snapshot(), [], undefined, { timeZone: 'Asia/Shanghai', proseLanguage: 'zh-CN' })
}

const system = (): string => messages().find(message => message.role === 'system')!.content
const user = (): Record<string, unknown> => JSON.parse(messages().find(message => message.role === 'user')!.content) as Record<string, unknown>

it('requires the first paragraph to state the stance in words', () => {
  // 提醒：`stance` 是闭集、校验得到；「偏向」在正文里有没有用词说出来只能靠提示词。
  expect(system()).toContain('`whyRelated` **必须用词说出偏向**')
  expect(system()).toContain('读者只看得到这三句拼成的第一段，偏向必须从第一段就读得出来')
})

it('makes gaps mean “cannot judge”: undecided direction, no direction in the reader text', () => {
  expect(system()).toContain('**有 `gaps` 时这条解读就是「判不了」**')
  expect(system()).toContain('`outlook.direction` 必须写 `undecided`')
  expect(system()).toContain('第三段写成「无法判断 + 何时能判断」')
})

it('hands every fact its reader-formatted observedAtText and the selectable refs', () => {
  const payload = user()
  expect(payload.news).toMatchObject({ evidenceRef: expect.stringMatching(/^e\d+$/) })
  expect(payload.facts).toEqual(expect.arrayContaining([
    expect.objectContaining({ factRef: expect.stringMatching(/^f\d+$/), observedAtText: '2026-11-17 19:30 GMT+8' })
  ]))
  expect(payload.marketFactRefs).toEqual(expect.arrayContaining([expect.stringMatching(/^f\d+$/)]))
  expect(system()).toContain('必须逐字包含该事实的 `observedAtText`')
})
