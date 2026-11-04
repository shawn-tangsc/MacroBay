// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { dailyBriefingClient } from './dailyBriefingClient'

const document = (): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date: '2026-10-30', locale: 'zh-CN', generatedAt: '2026-10-30T00:30:00.000Z',
    windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text: '今日要点。', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: { items: [], macro: [], notes: {} },
  data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'empty' } } },
  conclusion: null,
  next: { items: [] },
  citations: [],
  provenance: { summaryId: null, readAt: '2026-10-30T00:30:00.000Z' }
})

afterEach(() => vi.unstubAllGlobals())

function stubInvoke(handler: (method: string, payload: unknown) => unknown): void {
  vi.stubGlobal('window', {
    platform: { products: { invoke: async (_product: string, method: string, payload: unknown) => handler(method, payload) } }
  })
}

describe('daily briefing client', () => {
  it('accepts a well-formed edition and a missing day', async () => {
    stubInvoke((method) => {
      if (method === 'intelligence.dailyBriefing.getToday') return { state: 'available', document: document() }
      if (method === 'intelligence.dailyBriefing.get') return { state: 'missing' }
      if (method === 'intelligence.dailyBriefing.regenerate') return { state: 'available', document: document() }
      return []
    })
    const today = await dailyBriefingClient.getToday({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(today.state).toBe('available')
    const missing = await dailyBriefingClient.get({ date: '2026-10-01', locale: 'zh-CN' })
    expect((await dailyBriefingClient.regenerate({ locale: 'zh-CN', timeZone: 'UTC' })).state).toBe('available')
    expect(missing.state).toBe('missing')
  })

  it('reads attempts, and reports an unreadable list instead of an empty one', async () => {
    stubInvoke((method) => {
      if (method === 'intelligence.dailyBriefing.listAttempts') return { state: 'available', attempts: [
        { attemptNo: 2, state: 'succeeded', startedAt: '2026-11-02T00:00:00.000Z', finishedAt: '2026-11-02T00:05:00.000Z', cleanedAt: '2026-11-02T00:10:00.000Z' },
        { attemptNo: 1, state: 'failed', failureCode: 'source-failed', startedAt: '2026-11-02T00:00:00.000Z', finishedAt: '2026-11-02T00:01:00.000Z' }
      ] }
      return {}
    })
    const result = await dailyBriefingClient.listAttempts({ date: '2026-11-02', locale: 'zh-CN', periodId: 'default' })
    expect(result.state).toBe('available')
    if (result.state === 'available') expect(result.attempts.map((attempt) => attempt.attemptNo)).toEqual([2, 1])

    stubInvoke(() => ({ state: 'available', attempts: [{ attemptNo: 'x' }] }))
    expect(await dailyBriefingClient.listAttempts({ date: '2026-11-02', locale: 'zh-CN' })).toEqual({ state: 'unavailable' })
  })

  it('reads the storage upgrade state, and never calls an unread state ready', async () => {
    stubInvoke((method) => {
      if (method === 'intelligence.dailyBriefing.getStorageState') return { state: 'incomplete', reason: 'migration-failed' }
      if (method === 'intelligence.dailyBriefing.retryUpgrade') return { state: 'ready' }
      return {}
    })
    expect(await dailyBriefingClient.getStorageState()).toEqual({ state: 'incomplete', reason: 'migration-failed' })
    expect(await dailyBriefingClient.retryUpgrade()).toEqual({ state: 'ready' })

    stubInvoke(() => ({ state: 'incomplete', reason: 'something-else' }))
    expect(await dailyBriefingClient.getStorageState()).toEqual({ state: 'unavailable' })
    vi.stubGlobal('window', {})
    expect(await dailyBriefingClient.getStorageState()).toEqual({ state: 'unavailable' })
  })

  it('rejects a malformed document and a failed bridge without throwing', async () => {
    stubInvoke(() => ({ state: 'available', document: { schemaVersion: 1 } }))
    expect(await dailyBriefingClient.getToday({ locale: 'zh-CN', timeZone: 'UTC' })).toEqual({
      state: 'unavailable', failureCode: 'daily-briefing-request-failed'
    })
    vi.stubGlobal('window', {})
    expect((await dailyBriefingClient.getToday({ locale: 'zh-CN', timeZone: 'UTC' })).state).toBe('unavailable')
  })

  it('reads and saves the settings view without trusting a malformed resolved state', async () => {
    stubInvoke((method, payload) => {
      if (method === 'intelligence.dailyBriefing.getSettings') {
        return {
          settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
          generation: { periods: [{ id: 'default', generationTime: '08:00', generationTimeZone: null, generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *' }] },
          language: { settings: { primary: 'follow-ui', additional: [] }, plan: { locales: ['zh-CN'], primary: { requested: 'zh-CN', used: 'zh-CN' }, writeCount: 1 } },
          webSearchSupported: false,
          resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' }
        }
      }
      return {
        settings: { editorialEnabled: false, providerId: '', modelId: '', webSearchEnabled: false },
        generation: { periods: [{ id: 'default', generationTime: '09:30', generationTimeZone: null, generationTimeZoneInvalid: null, windowHours: 48, cronExpression: '30 9 * * *' }] },
        language: { settings: { primary: 'follow-ui', additional: ['en-US'] }, plan: { locales: ['zh-CN', 'en-US'], primary: { requested: 'zh-CN', used: 'zh-CN' }, writeCount: 2 } },
        webSearchSupported: true,
        resolved: { state: 'disabled' },
        patch: payload
      }
    })
    const settings = await dailyBriefingClient.getSettings()
    expect(settings.state).toBe('available')
    if (settings.state === 'available') {
      expect(settings.view.generation.periods[0]).toMatchObject({ generationTime: '08:00', windowHours: 24 })
      expect(settings.view.webSearchSupported).toBe(false)
      expect(settings.view.language.plan.writeCount).toBe(1)
    }
    const saved = await dailyBriefingClient.saveSettings({ generation: { generationTime: '09:30', windowHours: 48 } })
    expect(saved.state).toBe('available')
    if (saved.state === 'available') {
      expect(saved.view.resolved).toEqual({ state: 'disabled' })
      expect(saved.view.generation.periods[0]!.windowHours).toBe(48)
      expect(saved.view.language.plan.writeCount).toBe(2)
    }

    stubInvoke(() => ({ settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false }, resolved: { state: 'agent' } }))
    expect(await dailyBriefingClient.getSettings()).toEqual({
      state: 'unavailable', failureCode: 'daily-briefing-settings-invalid'
    })
  })

  it('requires the generation block to be well formed', async () => {
    stubInvoke(() => ({
      settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
      generation: { generationTime: '08:00', windowHours: '24' },
      resolved: { state: 'disabled' }
    }))
    expect(await dailyBriefingClient.getSettings()).toEqual({
      state: 'unavailable', failureCode: 'daily-briefing-settings-invalid'
    })
  })

  it('accepts a schema-7 edition that records its window and rejects one without it', async () => {
    const current = (): DailyBriefingDocument => ({
      ...document(),
      schemaVersion: 7,
      policyVersion: 'daily-briefing.v18',
      edition: { ...document().edition, windowHours: 48 }
    })
    stubInvoke(() => ({ state: 'available', document: current() }))
    expect((await dailyBriefingClient.getToday({ locale: 'zh-CN', timeZone: 'UTC' })).state).toBe('available')

    const missing = current()
    const { windowHours: _windowHours, ...edition } = missing.edition
    stubInvoke(() => ({ state: 'available', document: { ...missing, edition } }))
    expect((await dailyBriefingClient.getToday({ locale: 'zh-CN', timeZone: 'UTC' })).state).toBe('unavailable')
  })

  it('accepts a schema-10 edition that carries the stored drawings, and one that predates them', async () => {
    const briefing = document()
    const at = '2026-10-30T00:25:00.000Z'
    const row = {
      id: 'btc' as const, labelKey: 'dailyBriefing.row.btc',
      importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'largest-move' as const },
      state: 'available' as const, value: { number: 1.2, format: 'percent' as const },
      change: null, window: '24h' as const, observedAt: at
    }
    const current = (): DailyBriefingDocument => ({
      ...briefing,
      schemaVersion: 10,
      policyVersion: 'daily-briefing.v21',
      edition: { ...briefing.edition, windowHours: 24 },
      data: {
        ...briefing.data,
        market: [{ ...row, curve: [[{ at: '2026-10-29T00:30:00.000Z', returnPercent: 0 }, { at, returnPercent: 1.2 }]] }],
        leverage: {
          state: 'available',
          btc: { openInterestUsd: 7_000_000_000, series: [{ at: '2026-10-29T00:30:00.000Z', value: 6_000_000_000 }, { at, value: 7_000_000_000 }] },
          eth: {}
        },
        policyPath: {
          state: 'available', meetingDate: '2026-12-09', outcome: 'hike-25', probability: 77.5, observedAt: at,
          distribution: { 'no-change': 0.205, 'hike-25': 0.775, 'hike-50-plus': 0.015, 'cut-25': 0.004, 'cut-50-plus': 0.001 }
        }
      }
    })
    stubInvoke(() => ({ state: 'available', document: current() }))
    expect((await dailyBriefingClient.getToday({ locale: 'zh-CN', timeZone: 'UTC' })).state).toBe('available')

    // An edition generated before schema 10 has none of these fields and must still be readable: a
    // reader opening yesterday's brief must not be told the whole document is malformed.
    const older: DailyBriefingDocument = {
      ...briefing,
      schemaVersion: 9,
      policyVersion: 'daily-briefing.v20',
      edition: { ...briefing.edition, windowHours: 24 },
      data: { ...briefing.data, market: [row] }
    }
    stubInvoke(() => ({ state: 'available', document: older }))
    expect((await dailyBriefingClient.getToday({ locale: 'zh-CN', timeZone: 'UTC' })).state).toBe('available')
  })

  it('lists summaries and rejects one malformed summary', async () => {
    const summary = {
      date: '2026-10-30', locale: 'zh-CN', availableLocales: ['zh-CN'], state: 'generated',
      generatedAt: '2026-10-30T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z',
      readingsAvailable: 4
    }
    stubInvoke(() => ({ state: 'available', result: { editions: [summary] } }))
    const listed = await dailyBriefingClient.list({ locale: 'zh-CN', timeZone: 'UTC' })
    expect(listed.state).toBe('available')
    if (listed.state === 'available') expect(listed.result.editions[0]?.date).toBe('2026-10-30')

    stubInvoke(() => ({ state: 'available', result: { editions: [{ date: '2026-10-30' }] } }))
    expect((await dailyBriefingClient.list({ locale: 'zh-CN', timeZone: 'UTC' })).state).toBe('unavailable')
  })

  it('keeps a failed attempt trace and the stored edition trace, and drops a malformed one', async () => {
    const trace = {
      attemptId: '2026-10-30:zh-CN:2026-10-30T00:30:00.000Z',
      startedAt: '2026-10-30T00:30:00.000Z',
      finishedAt: '2026-10-30T00:30:02.000Z',
      state: 'failed',
      stages: [{ id: 'store', state: 'failed', failureCode: 'store-failed' }]
    }
    stubInvoke((method) => method === 'intelligence.dailyBriefing.regenerate'
      ? { state: 'unavailable', failureCode: 'store-failed', generationTrace: trace }
      : { state: 'unavailable', failureCode: 'source-failed', generationTrace: trace })
    const today = await dailyBriefingClient.getToday({ locale: 'zh-CN', timeZone: 'UTC' })
    expect(today).toMatchObject({ state: 'unavailable', failureCode: 'source-failed', generationTrace: trace })
    const regenerated = await dailyBriefingClient.regenerate({ locale: 'zh-CN', timeZone: 'UTC' })
    expect(regenerated).toMatchObject({ state: 'unavailable', failureCode: 'store-failed', generationTrace: trace })

    stubInvoke(() => ({ state: 'unavailable', failureCode: 'source-failed', generationTrace: { attemptId: 'x', stages: [{ id: 'nope' }] } }))
    const malformed = await dailyBriefingClient.getToday({ locale: 'zh-CN', timeZone: 'UTC' })
    expect(malformed).toEqual({ state: 'unavailable', failureCode: 'source-failed' })
  })
})

describe('generation progress', () => {
  it('reports the running attempt with its stages in pipeline order', async () => {
    stubInvoke((method) => method === 'intelligence.dailyBriefing.getProgress'
      ? {
          state: 'running',
          progress: {
            attemptId: '2026-11-02:zh-CN:2026-11-02T01:30:00.000Z',
            startedAt: '2026-11-02T01:30:00.000Z',
            stages: [
              { id: 'source', state: 'success', startedAt: '2026-11-02T01:30:00.000Z', durationMs: 400 },
              { id: 'candidates', state: 'pending', startedAt: '2026-11-02T01:30:00.400Z' },
              { id: 'store', state: 'pending' }
            ]
          }
        }
      : { state: 'idle' })
    const result = await dailyBriefingClient.getProgress({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(result.state).toBe('running')
    if (result.state !== 'running') return
    expect(result.progress.stages.map((stage) => [stage.id, stage.state])).toEqual([
      ['source', 'success'],
      ['candidates', 'pending'],
      ['store', 'pending']
    ])
  })

  it('says idle when nothing runs, and unavailable when the reply cannot be read', async () => {
    stubInvoke(() => ({ state: 'idle' }))
    expect(await dailyBriefingClient.getProgress({ locale: 'zh-CN', timeZone: 'UTC' })).toEqual({ state: 'idle' })

    // "Cannot read the progress" must not be reported as "nothing is running": a reader would stop
    // waiting for a run that is still going.
    stubInvoke(() => ({ state: 'running', progress: { attemptId: 'x', startedAt: 'y', stages: [{ id: 'no-such-stage', state: 'pending' }] } }))
    expect(await dailyBriefingClient.getProgress({ locale: 'zh-CN', timeZone: 'UTC' })).toEqual({ state: 'unavailable' })
    stubInvoke(() => { throw new Error('ipc-down') })
    expect(await dailyBriefingClient.getProgress({ locale: 'zh-CN', timeZone: 'UTC' })).toEqual({ state: 'unavailable' })
  })
})
