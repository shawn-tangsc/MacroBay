import { describe, expect, it, vi } from 'vitest'

import { handleGetPolicyPath } from './readPolicyPathHandler'

const deps = (reading: unknown) => ({
  jobRuntime: {} as never,
  getAppLanguage: async () => 'zh-CN' as const,
  macroCalendarOps: {} as never,
  crossAssetOps: {} as never,
  policyPath: { read: vi.fn(() => reading) }
})

const reading = {
  meetingDate: '2026-12-09', daysUntilMeeting: 39, hasProjectionMaterials: true,
  targetRange: { lowerPercent: 3.75, upperPercent: 4 },
  probability: {
    venue: 'polymarket', outcome: 'hike-25', value: 0.71, asOf: '2026-10-30T15:00:00.000Z',
    // 逐点序列是画图用的输入，1600 条进模型上下文是事故；这条用例就是那个「不许」的判据。
    series: [
      { at: '2026-10-29T15:00:00.000Z', values: { 'no-change': 0.28, 'hike-25': 0.71, 'hike-50-plus': 0, 'cut-25': 0.01, 'cut-50-plus': 0 } },
      { at: '2026-10-30T15:00:00.000Z', values: { 'no-change': 0.28, 'hike-25': 0.71, 'hike-50-plus': 0, 'cut-25': 0.01, 'cut-50-plus': 0 } }
    ]
  },
  staleness: 'live'
}

describe('policy path agent tool', () => {
  it('answers with the same reading the panel shows and names the price caveat', async () => {
    const result = await handleGetPolicyPath({ asOf: '2026-10-30T15:01:00.000Z' }, deps(reading) as never)
    expect(result).toMatchObject({ state: 'available', meetingDate: '2026-12-09' })
    expect((result as { caveats: string[] }).caveats).toContain('odds-are-market-pricing')
  })

  it('never ships the drawn series to the model', async () => {
    const result = await handleGetPolicyPath({ asOf: '2026-10-30T15:01:00.000Z' }, deps(reading) as never) as {
      reading: { probability?: Record<string, unknown> }
    }
    expect(result.reading.probability).toBeDefined()
    expect(result.reading.probability).not.toHaveProperty('series')
    expect(result.reading.probability).not.toHaveProperty('seriesTruncated')
    // The facts the model may use survive: only the rendering input is dropped.
    expect(result.reading.probability).toMatchObject({ outcome: 'hike-25', value: 0.71 })
  })

  it('marks a missing 24h change and a stale SEP meeting as caveats', async () => {
    const result = await handleGetPolicyPath({ asOf: '2026-10-30T15:01:00.000Z' }, deps({
      ...reading,
      sep: { asOf: '2026-09-16', medianPath: { y2026: 4.1 }, sourceUrl: 'https://example.invalid' }
    }) as never)
    expect((result as { caveats: string[] }).caveats).toEqual(expect.arrayContaining([
      'twenty-four-hour-change-not-yet-available', 'projections-from-latest-sep-meeting'
    ]))
  })

  it('refuses an answer without a usable boundary or a meeting', async () => {
    expect(await handleGetPolicyPath({}, deps(reading) as never)).toMatchObject({ state: 'unavailable', failureCode: 'as-of-invalid' })
    expect(await handleGetPolicyPath({ asOf: '2026-10-30T15:01:00.000Z' }, deps(undefined) as never)).toMatchObject({ state: 'unavailable', failureCode: 'meeting-not-found' })
  })
})
