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
        return { settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false }, generation: { generationTime: '08:00', windowHours: 24, cronExpression: '0 8 * * *' }, resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' } }
      }
      return {
        settings: { editorialEnabled: false, providerId: '', modelId: '', webSearchEnabled: false },
        generation: { generationTime: '09:30', windowHours: 48, cronExpression: '30 9 * * *' },
        resolved: { state: 'disabled' },
        patch: payload
      }
    })
    const settings = await dailyBriefingClient.getSettings()
    expect(settings.state).toBe('available')
    if (settings.state === 'available') {
      expect(settings.view.generation).toEqual({ generationTime: '08:00', windowHours: 24, cronExpression: '0 8 * * *' })
    }
    const saved = await dailyBriefingClient.saveSettings({ generation: { generationTime: '09:30', windowHours: 48 } })
    expect(saved.state).toBe('available')
    if (saved.state === 'available') {
      expect(saved.view.resolved).toEqual({ state: 'disabled' })
      expect(saved.view.generation.windowHours).toBe(48)
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
})
