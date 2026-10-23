import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { prepareMarketCollection, zeroXRouterCalendarStoragePolicy as policy } from './marketCalendarStorageValidation'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'

const harness = join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/0xrouter-calendar/marketCalendarStoragePerformanceHarness.mts')
// Explicit opt-in only. Native Node process, never a Vitest RSS measurement.
const scale = process.env.MC3_STORAGE_PERFORMANCE === '100k' ? 100_000
  : process.env.MC3_STORAGE_PERFORMANCE === '1' ? 1_000_000 : undefined
describe('isolated market calendar storage performance gate', () => {
  it('provides a standalone opt-in Node lifecycle gate separate from allocation diagnostics', () => {
    expect(existsSync(harness)).toBe(true)
    const source = readFileSync(harness, 'utf8')
    expect(source).not.toMatch(/node:inspector|HeapProfiler|globalThis\.gc/u)
    expect(source).toContain('finalResource.maxRSS * 1024 - baseline.rss')
    expect(source.indexOf('const finalResource =')).toBeLessThan(source.indexOf('const report ='))
    expect(source).toContain('resource-preflight')
    expect(source).toContain('scales: [100_000, 1_000_000]')
    expect(policy.marketBytes).toBe(20 * 1024 ** 3)
  })

  it('uses the accepted 192 MiB policy for both the report and lifecycle exit gate', () => {
    const source = readFileSync(harness, 'utf8')
    expect(source).toContain('maximumRssIncrement: 192 * 1024 ** 2')
    expect(source).toContain('rssBudgetBytes: harnessPolicy.maximumRssIncrement')
    expect(source).toContain('withinRssBudget: finalResource.maxRSS * 1024 - baseline.rss <= harnessPolicy.maximumRssIncrement')
    expect(source).toContain('if (finalResource.maxRSS * 1024 - baseline.rss > harnessPolicy.maximumRssIncrement ||')
    expect(source).not.toContain('within128MiB')
  })

  it('provides verified representative-mixed distribution and an independent startup gate', () => {
    const source = readFileSync(harness, 'utf8')
    expect(source).toContain('boundaryRowsPerBatch: 50')
    expect(source).toContain('startupP95Ms: 100')
    expect(source).toContain('startupP95Ms: p95(startupTimes)')
    expect(source).toContain('startupTimes.push(performance.now() - startupStart)')
    expect(source).toContain('report.startupP95Ms! > harnessPolicy.startupP95Ms')
    expect(source).toContain('reopenStartupMs')
    expect(source).toContain('representative-mixed')
    expect(source.indexOf('const startupStart =')).toBeLessThan(source.indexOf('const queryStart ='))
    expect(source.indexOf('startupTimes.push(')).toBeLessThan(source.indexOf('const queryStart ='))
  })

  it('derives exactly 50 boundary observations and preserves 950 standard drafts for actual batch identities', async () => {
    const source = readFileSync(harness, 'utf8')
    expect(source).toContain('export function representativeMixedBatch')
    const { representativeMixedBatch } = await import('./marketCalendarStoragePerformanceHarness.mts')
    for (const [collectionId, locale] of [['synthetic-00000000', 'zh'], ['longer-derived-collection-identity', 'en']] as const) {
      const scope = { providerId: '0xrouter', descriptorId: 'macro-calendar-0xrouter-economic-data', locale, month: '2026-09' }
      const context = { ...scope, detectedAt: '2026-09-08T00:00:00.000Z', evidence: {
        providerId: scope.providerId, descriptorId: scope.descriptorId, rawRecordId: 'derived-evidence', evidenceHash: 'a'.repeat(64)
      } }
      const parseResult = parseZeroXRouterEconomicData({ code: 200, msg: '', data: Array.from({ length: 1000 }, (_, i) => ({
        calendarId: 'synthetic', id: i + 1, calendarName: 'Derived '.repeat(50), locale, star: 3,
        pubTimestamp: Date.parse('2026-09-09T12:00:00.000Z'), countryName: 'Derived country '.repeat(20),
        estimateValue: '0', preValue: 'Previous '.repeat(40), pubValue: 'Actual '.repeat(45)
      })) }, locale)
      expect(parseResult.state).toBe('succeeded')
      if (parseResult.state !== 'succeeded') throw new Error('derived-parser-failed')
      const input = { ...scope, collectionId, parserVersion: 'mc2-derived', parseResult }
      const mixed = representativeMixedBatch(input, context)
      expect(mixed.input.parseResult.drafts.slice(50)).toEqual(parseResult.drafts.slice(50))
      const rows = prepareMarketCollection(mixed.input, context).observations
      const sizes = rows.map(row => Buffer.byteLength(JSON.stringify(row)))
      expect(sizes.slice(0, 50)).toEqual(Array(50).fill(8192))
      expect(sizes.slice(50).every(bytes => bytes < 8192)).toBe(true)
      expect(mixed.distribution).toEqual({ longRows: 50, shortRows: 950,
        minSerializedBytes: Math.min(...sizes), maxSerializedBytes: 8192 })
      expect(() => representativeMixedBatch({ ...input, parseResult: { ...parseResult, drafts: parseResult.drafts.slice(1) } }, context)).toThrow()
    }
  })

  it.runIf(scale !== undefined)('runs only the explicitly authorized scale in standard Node', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', harness, String(scale)], {
      encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 ** 2
    })
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    const lines = result.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
    const summary = lines.find(line => line.summary)?.summary
    const report = lines.find(line => line.report)?.report
    expect(summary.generatedObservations).toBe(scale! + 1)
    expect(summary.rssBudgetBytes).toBe(192 * 1024 ** 2)
    expect(summary.withinRssBudget).toBe(true)
    expect(summary).not.toHaveProperty('within128MiB')
    expect(summary.lifecycleDeltaBytes).toBeLessThanOrEqual(summary.rssBudgetBytes)
    expect(summary.startupBudgetMs).toBe(100)
    expect(summary.withinStartupBudget).toBe(true)
    expect(report.startupSamples).toBe(30)
    expect(report.startupP95Ms).toBeLessThanOrEqual(summary.startupBudgetMs)
    expect(report.reopenStartupMs).toBeGreaterThanOrEqual(0)
  }, 600_000)
})
