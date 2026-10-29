import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

vi.mock('../intelligenceModule', () => ({ getIntelligenceModule: vi.fn() }))

import { getIntelligenceModule } from '../intelligenceModule'
import { handleGetLatestConclusion } from './readHandlers'

const summary = {
  id: 's1', createdAt: '2026-10-30T00:00:00.000Z', eventAssessment: 'Legacy assessment',
  conclusion: {
    direction: 'bearish', summary: 'Flows pull bids away.', change: 'No comparable change.',
    conditions: ['Stablecoins keep contracting'], macro: null, evidenceStrength: null, dataGaps: []
  },
  counterEvidence: [{ statement: 'BTC ETF took in $110M.', evidenceRefId: 'ev-2' }],
  directions: [{ horizon: 'medium', direction: 'bearish', rationale: 'ETF flows confirm.', confidence: 'medium', evidenceRefIds: ['ev-2'] }],
  dataCaveats: []
} as never

const prediction = {
  asset: 'BTC', horizonEnd: '2026-10-31T00:00:00.000Z',
  invalidation: 'Stablecoins turn positive.'
}

function repositoryWith(overrides: Record<string, unknown> = {}) {
  return {
    listTimeline: vi.fn(() => ({
      items: [
        { id: 't1', status: 'published', kind: 'analysis', occurredAt: '2026-10-30T00:00:00.000Z', summaryRef: 's1', direction: 'bearish' },
        { id: 't2', status: 'published', kind: 'review', occurredAt: '2026-10-29T00:00:00.000Z', summaryRef: 's2', direction: 'range' }
      ],
      nextCursor: null
    })),
    getSummary: vi.fn((id: string) => id === 's1' ? summary : { ...(summary as object), id } as never),
    listPredictions: vi.fn(() => [prediction]),
    ...overrides
  }
}

const deps = {
  jobRuntime: {} as JobRuntime,
  getAppLanguage: async () => 'zh-CN' as const,
  macroCalendarOps: {} as never,
  crossAssetOps: {} as never
}

beforeEach(() => vi.mocked(getIntelligenceModule).mockReset())

describe('handleGetLatestConclusion', () => {
  it('returns the newest published conclusion at or before asOf', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue({ marketAnalysisRuntime: { repository: repositoryWith() } } as never)
    const result = (await handleGetLatestConclusion({ asOf: '2026-10-30T00:30:00.000Z' }, deps)) as Record<string, unknown>

    expect(result).toMatchObject({
      state: 'available', summaryId: 's1', direction: 'bearish',
      summary: 'Flows pull bids away.', conditions: ['Stablecoins keep contracting']
    })
    expect(result.invalidations).toEqual([{ asset: 'BTC', horizonEnd: '2026-10-31T00:00:00.000Z', text: 'Stablecoins turn positive.' }])
    expect(result.counterEvidence).toEqual([{ statement: 'BTC ETF took in $110M.', evidenceRefId: 'ev-2' }])
    expect(result.directions).toEqual([{ horizon: 'medium', direction: 'bearish', confidence: 'medium', rationale: 'ETF flows confirm.' }])
    expect(result.caveats).toEqual([])
  })

  it('does not let a conclusion published after asOf leak backwards', async () => {
    const repository = repositoryWith()
    vi.mocked(getIntelligenceModule).mockReturnValue({ marketAnalysisRuntime: { repository } } as never)
    const result = (await handleGetLatestConclusion({ asOf: '2026-10-29T12:00:00.000Z' }, deps)) as Record<string, unknown>
    expect(result.summaryId).toBe('s2')
    expect(repository.getSummary).toHaveBeenCalledWith('s2')
  })

  it('returns empty before the first publication', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue({ marketAnalysisRuntime: { repository: repositoryWith() } } as never)
    const result = (await handleGetLatestConclusion({ asOf: '2026-10-27T00:00:00.000Z' }, deps)) as Record<string, unknown>
    expect(result).toEqual({ state: 'empty', asOf: '2026-10-27T00:00:00.000Z', caveats: ['no-published-conclusion'] })
  })

  it('uses the legacy assessment with a caveat and rejects an invalid asOf', async () => {
    const legacy = { ...(summary as object), conclusion: undefined, eventAssessment: 'Legacy assessment' } as never
    vi.mocked(getIntelligenceModule).mockReturnValue({
      marketAnalysisRuntime: { repository: repositoryWith({ getSummary: vi.fn(() => legacy) }) }
    } as never)
    const result = (await handleGetLatestConclusion({ asOf: '2026-10-30T00:30:00.000Z' }, deps)) as Record<string, unknown>
    expect(result).toMatchObject({ summary: 'Legacy assessment', direction: 'bearish', caveats: ['legacy-conclusion'] })
    await expect(handleGetLatestConclusion({ asOf: 'not-a-time' }, deps)).rejects.toThrow('latest-conclusion-invalid-as-of')
  })

  it('states an empty result when the summary row is gone', async () => {
    vi.mocked(getIntelligenceModule).mockReturnValue({
      marketAnalysisRuntime: { repository: repositoryWith({ getSummary: vi.fn(() => undefined) }) }
    } as never)
    expect(await handleGetLatestConclusion({ asOf: '2026-10-30T00:30:00.000Z' }, deps)).toEqual({
      state: 'empty', asOf: '2026-10-30T00:30:00.000Z', caveats: ['summary-not-found']
    })
  })
})
