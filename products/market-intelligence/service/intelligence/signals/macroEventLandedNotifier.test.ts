import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import {
  buildMacroEventLandedRequest,
  notifyMacroEventLandings,
  selectLandedReleases,
  type MacroEventLanding
} from './macroEventLandedNotifier'

const asOf = '2026-09-10T12:00:00.000Z'
const released = '2026-09-10T10:00:00.000Z'

function event(overrides: Partial<MarketCalendarEvent> = {}): MarketCalendarEvent {
  return {
    eventKey: 'batch-hmac-1',
    observationKey: 'US.CPI.RELEASE.2026-M08',
    title: 'CPI',
    countryCode: 'US',
    eventType: 'economic-indicator',
    importance: 'high',
    scheduledAt: released,
    // 2 → 3 is +50% against consensus: over the release trigger's 5% for bare numbers.
    consensus: { displayValue: '2' },
    providerPrevious: { displayValue: '2' },
    providerActual: { displayValue: '3' },
    source: '0xRouter',
    sourceObservedAt: asOf,
    coverage: 'observed-unverified',
    ...overrides
  }
}

/** 选中的落地条目：除了 id 与时刻，还要带上读者能看懂的那几样。 */
function landing(overrides: Partial<MacroEventLanding> = {}): MacroEventLanding {
  return {
    eventId: 'US.CPI.RELEASE.2026-M08',
    releaseAt: released,
    countryCode: 'US',
    title: 'CPI',
    actual: '3',
    consensus: '2',
    previous: '2',
    comparison: 'above',
    ...overrides
  }
}

describe('macro event landed notifier', () => {
  it('names the release and the instant the data describes, and leaves the key to the platform', () => {
    const request = buildMacroEventLandedRequest(landing())
    expect(request).toMatchObject({
      eventTypeId: 'market-intelligence.macro.event-landed',
      producerId: 'market-intelligence.calendar-refresh',
      dedupeVars: { builder: 'template', vars: { eventId: 'US.CPI.RELEASE.2026-M08', releaseAt: released } },
      actions: [],
      occurredAt: released
    })
    // No deeplink and no action: the shell resolves settings sections only, so an "open" button
    // would point nowhere. A button that cannot go anywhere is worse than no button.
    expect(request).not.toHaveProperty('deeplink')
    // 成品句子在源头拼好：国家翻成「美国」、指标查表、方向是词，三个值原样进句子。
    expect(request?.titleParams).toBeUndefined()
    expect(request?.bodyVariant).toBeUndefined()
    expect(request?.rendered?.['zh-CN']).toEqual({
      // 没有稳定标识 → 指标名用源站原文；国家仍翻（国家不是数据，是读者认得的名字）。
      title: '美国 CPI 高于预期',
      body: '实际 3，预期 2，前值 2',
      reason: '读数达到这条规则的意外阈值。'
    })
    expect(request?.rendered?.['en-US']).toEqual({
      title: 'US CPI above forecast',
      body: 'Actual 3 vs 2 forecast; previous 2',
      reason: 'The reading crossed this rule’s surprise threshold.'
    })
    // 缺前值换句子：不拼「—」，也不留一个空括号。
    expect(buildMacroEventLandedRequest(landing({ previous: undefined }))?.rendered?.['zh-CN']?.body)
      .toBe('实际 3，预期 2，前值没有公布')
    for (const bad of [{ ...landing(), eventId: '' }, { ...landing(), releaseAt: 'not-an-instant' }]) {
      expect(buildMacroEventLandedRequest(bad)).toBeUndefined()
    }
  })

  it('keeps the signed filter: only a US, high-importance release that beat its consensus', () => {
    // Nothing here may widen what the analysis line already signs: a planned release that came in
    // on consensus is not news, and a release the reader cannot compare is not news either.
    const routine = event({ eventKey: 'batch-2', observationKey: 'US.NFP.RELEASE.2026-M09', providerActual: { displayValue: '2.05' } })
    const incomparable = event({ eventKey: 'batch-3', observationKey: 'US.PPI.RELEASE.2026-M08', consensus: null })
    const foreign = event({ eventKey: 'batch-4', observationKey: 'DE.CPI.RELEASE.2026-M08', countryCode: 'DE' })
    const lowImportance = event({ eventKey: 'batch-5', observationKey: 'US.JOBS.RELEASE.2026-M08', importance: 'medium' })
    const notYetDue = event({ eventKey: 'batch-6', observationKey: 'US.GDP.RELEASE.2026-Q3', scheduledAt: '2026-09-11T10:00:00.000Z' })
    const noActual = event({ eventKey: 'batch-7', observationKey: 'US.RETAIL.RELEASE.2026-M08', providerActual: null })
    const stale = event({ eventKey: 'batch-8', observationKey: 'US.ISM.RELEASE.2026-M07', scheduledAt: '2026-08-01T10:00:00.000Z' })

    const selection = selectLandedReleases([event(), routine, incomparable, foreign, lowImportance, notYetDue, noActual, stale], asOf)
    expect(selection.landings).toEqual([landing()])
    // The two that were dropped for a reason worth counting are counted: "signed filter kept" and
    // "we read nothing" must not look the same in a log.
    expect(selection.suppressed).toEqual({ notComparable: 1, belowThreshold: 1, missingTitle: 0 })
    // A release this process already announced is not announced again, even though the key would merge.
    expect(selectLandedReleases([event()], asOf, new Set(['US.CPI.RELEASE.2026-M08:2026-09-10T10:00:00.000Z'])).landings).toEqual([])
    // `eventKey` is a per-batch HMAC: two collections of one release carry different ones, so identity
    // has to be `observationKey` or every refresh would read as a new event.
    expect(selectLandedReleases([event({ eventKey: 'another-hmac' })], asOf).landings).toEqual([landing()])
  })

  it('refuses to announce a release with no indicator name, and counts it', () => {
    // 空标题会拼出「美国  高于预期」：双空格、没有指标，比不发更糟。纯空格走同一条路。
    const empty = selectLandedReleases([event({ title: '' })], asOf)
    expect(empty.landings).toHaveLength(0)
    expect(empty.suppressed).toEqual({ notComparable: 0, belowThreshold: 0, missingTitle: 1 })
    const blank = selectLandedReleases([event({ title: '   ' })], asOf)
    expect(blank.landings).toHaveLength(0)
    expect(blank.suppressed.missingTitle).toBe(1)
    // 构建层再挡一次：没有指标名就没有请求。
    expect(buildMacroEventLandedRequest(landing({ title: '' }))).toBeUndefined()
  })

  it('submits once, remembers what it said, and leaves a readable trace when a submit fails', async () => {
    const submit = vi.fn(async () => ({ kind: 'recorded' } as never))
    const seen = new Map<string, number>()
    const landings = [landing()]
    await expect(notifyMacroEventLandings(submit, landings, seen)).resolves.toBe(1)
    await expect(notifyMacroEventLandings(submit, landings, seen)).resolves.toBe(0)
    expect(submit).toHaveBeenCalledTimes(1)
    // A failed submit must not fail the collection that already stored the data - but it must be
    // countable. An empty catch made a real failure look like "there was nothing to say".
    const trace = vi.fn()
    const failing = vi.fn(async () => Promise.reject(new Error('no runtime')))
    await expect(notifyMacroEventLandings(failing, landings, new Map(), trace)).resolves.toBe(0)
    expect(trace).toHaveBeenCalledWith({ kind: 'submit-failed', count: 1, detail: 'Error: no runtime' })
    await expect(notifyMacroEventLandings(undefined, landings, new Map())).resolves.toBe(0)
  })

  // 反向用例的另一半：只断言「采集侧会发」不够——如果分析闸门那侧还留着一条提交，整条链删掉也绿。
  it('has exactly one submitter: the collection side, and nothing from the analysis gate', () => {
    const gate = readFileSync(new URL('../jobs/registerMarketAnalysisRuntime.ts', import.meta.url), 'utf8')
    expect(gate).not.toContain('macro.event-landed')
    expect(gate).not.toContain('notifyMacroEventLandings')
    const callers: string[] = []
    const walk = (directory: URL): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
        if (entry.isDirectory()) { walk(child); continue }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
        // 定义处不算调用点：这一条要找的是「谁在发」。
        if (entry.name === 'macroEventLandedNotifier.ts') continue
        if (readFileSync(child, 'utf8').includes('notifyMacroEventLandings(')) callers.push(String(child))
      }
    }
    walk(new URL('../macro-calendar/', import.meta.url))
    walk(new URL('./', import.meta.url))
    // One implementation, one call site: a second caller is how one release ends up announced twice.
    expect(callers).toHaveLength(1)
    expect(callers[0]).toContain('zeroXRouterCalendarManualRuntime.ts')
    expect(join('signals', 'macroEventLandedNotifier.ts')).toContain('macroEventLandedNotifier')
  })
})
