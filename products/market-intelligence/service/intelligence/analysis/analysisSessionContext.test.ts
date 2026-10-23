import { expect, it } from 'vitest'

import { analysisSessionContext, sessionBriefForTriggerKey } from './analysisSessionContext'
import { buildAnalysisMessages } from './analysisModelPrompt'
import { slotInstantAtOrBefore } from './analysisSlotCoverage'
import type { EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'

const snapshot: EvidenceSnapshot = {
  id: 'mi-es-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', asOf: '2026-10-14T09:05:00.000Z',
  dataCutoff: '2026-10-14T09:05:00.000Z', profileId: 'crypto-market-analysis-v1', facts: [], missingDomains: [],
  caveats: [], evidenceRefs: [], sourceHealth: [], createdAt: '2026-10-14T09:05:00.000Z',
  policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
}

const body = (session?: Parameters<typeof buildAnalysisMessages>[2]) =>
  JSON.parse(buildAnalysisMessages(snapshot, [], session)[1]!.content as string)

it('describes every open once, as a prior to test rather than a conclusion', () => {
  for (const slot of ['asia', 'europe', 'us'] as const) {
    const brief = analysisSessionContext[slot]
    expect(brief.slot).toBe(slot)
    expect(brief.localTime).toMatch(/^\d{2}:00$/)
    expect(brief.liquidity.length).toBeGreaterThan(0)
    expect(brief.typicalVolatility.length).toBeGreaterThan(0)
    expect(brief.typicalTradingStyle.length).toBeGreaterThan(0)
    expect(brief.dominantDrivers.length).toBeGreaterThan(0)
    expect(brief.checkpoints.length).toBeGreaterThan(0)
  }
  // The three opens must not be described by the same words, or the difference the reader asked for
  // is not in the prompt at all.
  expect(new Set(['asia', 'europe', 'us'].map(slot => analysisSessionContext[slot as 'asia'].typicalTradingStyle)).size).toBe(3)
  expect(new Set(['asia', 'europe', 'us'].map(slot => analysisSessionContext[slot as 'asia'].typicalVolatility)).size).toBe(3)
})

it('resolves a session only from a slot trigger key', () => {
  expect(sessionBriefForTriggerKey('schedule.asia.open')?.label).toBe('亚洲盘')
  expect(sessionBriefForTriggerKey('schedule.europe.open')?.label).toBe('欧洲盘')
  expect(sessionBriefForTriggerKey('schedule.us.open')?.label).toBe('美洲盘')
  for (const key of ['manual.refresh', 'calendar.refresh', 'staleness.floor', null, undefined]) {
    expect(sessionBriefForTriggerKey(key), String(key)).toBeNull()
  }
})

it('names the open a delayed catch-up is serving', () => {
  // 09:05 catching up the 00:00 open: the prompt must carry both instants, or the model reads the
  // current snapshot as the open's own state.
  const open = slotInstantAtOrBefore('us', new Date(2026, 9, 14, 9, 5))
  expect(open).toBe(new Date(2026, 9, 14, 0, 0).toISOString())
  const session = { brief: analysisSessionContext.us, openInstant: open! }
  expect(body(session).session).toMatchObject({ open: '美洲盘开盘（本机 24:00）', delayed: true })
  expect(body(session).session.analyzedAt).toBe(snapshot.asOf)
  expect(body(session).session.typical.tradingStyle).toBe(analysisSessionContext.us.typicalTradingStyle)
  expect(body(session).session.typical.checkpoints).toEqual([...analysisSessionContext.us.checkpoints])
})

it('adds the session rules and segment for an open, and nothing for any other run', () => {
  const session = { brief: analysisSessionContext.asia, openInstant: new Date(2026, 9, 14, 8, 0).toISOString() }
  const messages = buildAnalysisMessages(snapshot, [], session)
  expect(messages[0]!.content).toContain('session 段只是待检验的先验')
  expect(messages[1]!.content).toContain('亚洲盘开盘（本机 08:00）')

  // A manual or data-driven run has no open to reason about.
  expect(body()).not.toHaveProperty('session')
  expect(buildAnalysisMessages(snapshot)[0]!.content).not.toContain('session 段只是待检验的先验')
})
