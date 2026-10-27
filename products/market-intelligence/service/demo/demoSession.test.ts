import { describe, expect, it, vi } from 'vitest'

import type { SampleModeCatalog } from './demoCatalog'
import { createSampleModeSession } from './demoSession'

const meta = {
  schemaVersion: 1 as const,
  id: 's1',
  title: { 'zh-CN': '示例', 'en-US': 'Sample' },
  scenarioNow: '2026-10-24T20:00:00.000Z',
  window: { from: '2026-10-17T20:00:00.000Z', to: '2026-10-24T20:00:00.000Z' },
  recordedAt: '2026-10-27T09:12:00.000Z',
  sources: []
}

function catalog(entries: number): SampleModeCatalog {
  return {
    locale: 'zh-CN',
    scenarios: entries === 0 ? [] : [{
      meta,
      surfaces: [],
      problems: [],
      entries: new Map([['intelligence.queryFearGreedSnapshot', { schemaVersion: 1, method: 'intelligence.queryFearGreedSnapshot', effect: 'read', payload: { score: 42 } }]])
    }],
    problems: []
  }
}

function jobs(overrides: Partial<{ fail: boolean }> = {}) {
  const removed: string[] = []
  const cancelled: string[] = []
  return {
    removed,
    cancelled,
    runtime: {
      listSchedules: () => [
        { id: 'job-a', productId: 'market-intelligence' },
        { id: 'job-b', productId: 'other-product' }
      ] as never,
      removeSchedule: (id: string) => { removed.push(id) },
      listRuns: () => [{ id: 'run-1', status: 'running' }] as never,
      cancel: (id: string) => {
        if (overrides.fail) throw new Error('cancel-failed')
        cancelled.push(id)
      }
    }
  }
}

describe('示例模式会话', () => {
  it('suspends only this product’s schedules on enter and restores on exit', async () => {
    const harness = jobs()
    const resumeWork = vi.fn(async () => undefined)
    const session = createSampleModeSession({
      productId: 'market-intelligence',
      loadCatalog: () => catalog(1),
      getLanguage: async () => 'zh-CN',
      jobs: harness.runtime,
      resumeWork
    })
    const view = await session.enter()
    expect(view).toMatchObject({ active: true, scenarioId: 's1', scenarioNow: meta.scenarioNow })
    expect(harness.removed).toEqual(['job-a'])
    expect(harness.cancelled).toEqual(['run-1'])

    await session.exit()
    expect(resumeWork).toHaveBeenCalledTimes(1)
    expect(session.view().active).toBe(false)
  })

  it('counts scenarios before entering so the control surface can offer the entry', async () => {
    const session = createSampleModeSession({
      productId: 'market-intelligence',
      loadCatalog: () => catalog(1),
      getLanguage: async () => 'zh-CN',
      jobs: jobs().runtime,
      resumeWork: async () => undefined
    })
    expect(session.view().scenarioCount).toBe(0)
    const view = await session.prepare()
    expect(view).toMatchObject({ active: false, scenarioCount: 1 })
    expect(view.unavailableReason).toBeUndefined()
  })

  it('reports no-scenario before entering when the catalog has no usable scenario', async () => {
    const session = createSampleModeSession({
      productId: 'market-intelligence',
      loadCatalog: () => catalog(0),
      getLanguage: async () => 'zh-CN',
      jobs: jobs().runtime,
      resumeWork: async () => undefined
    })
    const view = await session.prepare()
    expect(view).toMatchObject({ active: false, scenarioCount: 0, unavailableReason: 'no-scenario' })
  })

  it('re-resolves the scenario when the language changes while active', async () => {
    let language: 'zh-CN' | 'en-US' = 'zh-CN'
    const harness = jobs()
    const session = createSampleModeSession({
      productId: 'market-intelligence',
      getLanguage: async () => language,
      loadCatalog: (locale) => ({
        locale,
        problems: [],
        scenarios: [{
          meta,
          surfaces: [],
          problems: [],
          entries: new Map([['intelligence.queryFearGreedSnapshot', {
            schemaVersion: 1, method: 'intelligence.queryFearGreedSnapshot', effect: 'read',
            payload: { score: 42, locale }
          }]])
        }]
      }),
      jobs: harness.runtime,
      resumeWork: async () => undefined
    })
    await session.enter()
    expect(session.lookup('intelligence.queryFearGreedSnapshot', {})).toMatchObject({ locale: 'zh-CN' })

    language = 'en-US'
    await session.enter()
    expect(session.lookup('intelligence.queryFearGreedSnapshot', {})).toMatchObject({ locale: 'en-US' })
    // 语言切换不该把调度再暂停一遍。
    expect(harness.removed).toEqual(['job-a'])
  })

  it('pins “now” to the scenario clock only while active', async () => {
    const session = createSampleModeSession({
      productId: 'market-intelligence',
      loadCatalog: () => catalog(1),
      getLanguage: async () => 'zh-CN',
      jobs: jobs().runtime,
      resumeWork: async () => undefined,
      now: () => new Date('2026-10-27T10:00:00.000Z')
    })
    expect(session.now().toISOString()).toBe('2026-10-27T10:00:00.000Z')
    await session.enter()
    expect(session.now().toISOString()).toBe(meta.scenarioNow)
    await session.exit()
    expect(session.now().toISOString()).toBe('2026-10-27T10:00:00.000Z')
  })

  it('refuses to enter when no scenario is installed', async () => {
    const session = createSampleModeSession({
      productId: 'market-intelligence',
      loadCatalog: () => catalog(0),
      getLanguage: async () => 'zh-CN',
      jobs: jobs().runtime,
      resumeWork: async () => undefined
    })
    const view = await session.enter()
    expect(view.active).toBe(false)
    expect(view.unavailableReason).toBe('no-scenario')
  })

  it('stays out of sample mode and restores schedules when suspension fails', async () => {
    const harness = jobs()
    const resumeWork = vi.fn(async () => undefined)
    const session = createSampleModeSession({
      productId: 'market-intelligence',
      loadCatalog: () => catalog(1),
      getLanguage: async () => 'zh-CN',
      jobs: harness.runtime,
      suspendWork: async () => { throw new Error('suspend-failed') },
      resumeWork
    })
    const view = await session.enter()
    expect(view).toMatchObject({ active: false, unavailableReason: 'suspend-failed' })
    expect(resumeWork).toHaveBeenCalledTimes(1)
  })
})
