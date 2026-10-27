import { describe, expect, it } from 'vitest'

import { buildSampleModeCatalog } from './demoCatalog'

const meta = {
  schemaVersion: 1,
  id: 's1',
  title: { 'zh-CN': '示例', 'en-US': 'Sample' },
  scenarioNow: '2026-10-24T20:00:00.000Z',
  window: { from: '2026-10-17T20:00:00.000Z', to: '2026-10-24T20:00:00.000Z' },
  recordedAt: '2026-10-27T09:12:00.000Z',
  sources: ['binance-futures-positioning']
}

const base = 'p/scenarios/s1'

function input(overrides: { responses?: Record<string, unknown>; locale?: 'zh-CN' | 'en-US' } = {}) {
  return {
    scenarioFiles: { [`${base}/scenario.json`]: { default: meta } },
    surfacesFiles: { [`${base}/surfaces.json`]: { default: ['intelligence.queryFearGreedSnapshot'] } },
    responseFiles: overrides.responses ?? {},
    locale: overrides.locale ?? ('zh-CN' as const)
  }
}

describe('buildSampleModeCatalog', () => {
  it('indexes fixtures by method and prefers the active language over common', () => {
    const catalog = buildSampleModeCatalog(input({
      responses: {
        [`${base}/responses/common/intelligence.queryFearGreedSnapshot.json`]: {
          schemaVersion: 1, method: 'intelligence.queryFearGreedSnapshot', effect: 'read', payload: { score: 40 }
        },
        [`${base}/responses/zh-CN/intelligence.queryFearGreedSnapshot.json`]: {
          schemaVersion: 1, method: 'intelligence.queryFearGreedSnapshot', effect: 'read', payload: { score: 42 }
        }
      }
    }))
    expect(catalog.scenarios).toHaveLength(1)
    expect(catalog.scenarios[0]!.entries.get('intelligence.queryFearGreedSnapshot')?.payload).toEqual({ score: 42 })
  })

  it('falls back to english when the active language has no file', () => {
    const catalog = buildSampleModeCatalog(input({
      locale: 'zh-CN',
      responses: {
        [`${base}/responses/en-US/intelligence.queryFearGreedSnapshot.json`]: {
          schemaVersion: 1, method: 'intelligence.queryFearGreedSnapshot', effect: 'read', payload: { score: 42 }
        }
      }
    }))
    expect(catalog.scenarios[0]!.entries.get('intelligence.queryFearGreedSnapshot')).toBeDefined()
  })

  it('drops invalid fixtures and reports them instead of failing the whole catalog', () => {
    const catalog = buildSampleModeCatalog(input({
      responses: {
        [`${base}/responses/common/intelligence.queryFearGreedSnapshot.json`]: {
          schemaVersion: 1, method: 'wrong.method', effect: 'read', payload: {}
        }
      }
    }))
    expect(catalog.scenarios[0]!.entries.size).toBe(0)
    expect(catalog.problems.join(',')).toContain('invalid-fixture')
  })

  it('keeps the declared surfaces list', () => {
    const catalog = buildSampleModeCatalog(input())
    expect(catalog.scenarios[0]!.surfaces).toEqual(['intelligence.queryFearGreedSnapshot'])
  })
})
