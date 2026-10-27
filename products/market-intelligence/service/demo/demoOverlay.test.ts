import { describe, expect, it, vi } from 'vitest'

import type { SampleModeCatalog } from './demoCatalog'
import { wrapProductRegistrar } from './demoOverlay'
import { SAMPLE_MODE_ERRORS, SAMPLE_MODE_METHODS } from './demoScenario'
import { createSampleModeSession, type SampleModeSession } from './demoSession'

type Handler = (payload: unknown) => Promise<unknown>

function scenario() {
  return {
    meta: {
      schemaVersion: 1 as const,
      id: 's1',
      title: { 'zh-CN': '示例', 'en-US': 'Sample' },
      scenarioNow: '2026-10-24T20:00:00.000Z',
      window: { from: '2026-10-17T20:00:00.000Z', to: '2026-10-24T20:00:00.000Z' },
      recordedAt: '2026-10-27T09:12:00.000Z',
      sources: []
    },
    surfaces: [],
    problems: [],
    entries: new Map([
      ['intelligence.queryFearGreedSnapshot', {
        schemaVersion: 1 as const,
        method: 'intelligence.queryFearGreedSnapshot',
        effect: 'read' as const,
        payload: { state: 'available', asOf: '$asOf', score: 42, observedAt: '2026-10-24T12:00:00.000Z' }
      }],
      ['intelligence.crossAsset.query', {
        schemaVersion: 1 as const,
        method: 'intelligence.crossAsset.query',
        effect: 'read' as const,
        byRequestKey: 'range',
        byRequest: {
          '24h': { state: 'available', asOf: '$asOf', points: [] },
          '7d': { state: 'available', asOf: '$asOf', points: [] }
        }
      }]
    ])
  }
}

function catalog(): SampleModeCatalog {
  return { locale: 'zh-CN', scenarios: [scenario()], problems: [] }
}

function sessionFor(): SampleModeSession {
  return createSampleModeSession({
    productId: 'market-intelligence',
    loadCatalog: () => catalog(),
    getLanguage: async () => 'zh-CN',
    jobs: { listSchedules: () => [], removeSchedule: () => undefined, listRuns: () => [], cancel: () => undefined },
    resumeWork: async () => undefined,
    now: () => new Date('2026-10-27T10:00:00.000Z')
  })
}

function captureRegister(session: SampleModeSession, recorder?: Parameters<typeof wrapProductRegistrar>[2]) {
  const captured: { handler?: Handler } = {}
  const register = wrapProductRegistrar((_productId, _method, handler) => {
    captured.handler = handler as Handler
  }, session, recorder)
  return { captured, register }
}

describe('示例模式覆盖层', () => {
  it('passes every call through to the real handler while inactive', async () => {
    const { captured, register } = captureRegister(sessionFor())
    const real = vi.fn(async () => ({ from: 'real' }))
    register('market-intelligence', 'intelligence.queryFearGreedSnapshot', real)
    expect(await captured.handler!({ asOf: '2026-10-27T10:00:00.000Z' })).toEqual({ from: 'real' })
    expect(real).toHaveBeenCalledTimes(1)
  })

  it('records real reads while inactive, and nothing while replaying', async () => {
    const record = vi.fn()
    const recorder = { directory: 'raw', record, settled: async () => undefined }
    const { captured, register } = captureRegister(sessionFor(), recorder)
    register('market-intelligence', 'intelligence.queryFearGreedSnapshot', async () => ({ from: 'real' }))
    await captured.handler!({ asOf: '2026-10-27T10:00:00.000Z' })
    expect(record).toHaveBeenCalledTimes(1)
  })

  it('serves a recorded read and echoes the requested asOf', async () => {
    const session = sessionFor()
    await session.enter()
    const { captured, register } = captureRegister(session)
    const real = vi.fn(async () => ({ from: 'real' }))
    register('market-intelligence', 'intelligence.queryFearGreedSnapshot', real)
    expect(await captured.handler!({ asOf: '2026-10-24T20:00:00.000Z' })).toMatchObject({
      score: 42,
      asOf: '2026-10-24T20:00:00.000Z',
      observedAt: '2026-10-24T12:00:00.000Z'
    })
    expect(real).not.toHaveBeenCalled()
  })

  it('picks the response by request key', async () => {
    const session = sessionFor()
    await session.enter()
    const { captured, register } = captureRegister(session)
    register('market-intelligence', 'intelligence.crossAsset.query', async () => ({ from: 'real' }))
    expect(await captured.handler!({ range: '7d', asOf: '2026-10-24T20:00:00.000Z' })).toMatchObject({ state: 'available' })
  })

  it('refuses a write instead of falling through to the real handler', async () => {
    const session = sessionFor()
    await session.enter()
    const { captured, register } = captureRegister(session)
    const real = vi.fn(async () => 'written')
    register('market-intelligence', 'intelligenceSources.setEnabled', real)
    await expect(captured.handler!({ sourceId: 'x', enabled: true })).rejects.toThrow(SAMPLE_MODE_ERRORS.readOnly)
    expect(real).not.toHaveBeenCalled()
  })

  it('reports a missing surface rather than serving empty data', async () => {
    const session = sessionFor()
    await session.enter()
    const { captured, register } = captureRegister(session)
    register('market-intelligence', 'marketAnalysis.listTimeline', async () => ({ items: [] }))
    await expect(captured.handler!({})).rejects.toThrow(SAMPLE_MODE_ERRORS.surfaceMissing)
  })

  it('always lets the control plane through', async () => {
    const session = sessionFor()
    await session.enter()
    const { captured, register } = captureRegister(session)
    register('market-intelligence', SAMPLE_MODE_METHODS.setActive, async () => ({ active: false }))
    expect(await captured.handler!({ active: false })).toEqual({ active: false })
  })
})
