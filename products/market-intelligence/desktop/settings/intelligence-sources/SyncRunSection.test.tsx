// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { syncRunClient } from '../../shared/ipc/syncRunClient'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { SyncRunSection } from './SyncRunSection'

const text = productText['zh-CN'].settings.intelligenceSources.syncRun
let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  vi.spyOn(syncRunClient, 'list').mockResolvedValue({
    state: 'available',
    rows: [
      { at: '2026-10-30T08:27:20.000Z', runId: 'r1', correlationId: 'r1', taskLabel: '官方日历排期', sources: [{ sourceId: 'macro-calendar-fed', label: '美联储官方日历' }], handlerId: 'h1', action: 'collect', outcome: 'failed', analysis: { state: 'not-applicable' }, durationMs: 32_000, failureCode: 'provider-disabled', detail: 'Macro calendar schedule run failed: provider-disabled' },
      { at: '2026-10-30T08:25:00.000Z', runId: 'r2', correlationId: 'r2', taskLabel: 'AI 分析', sources: [], handlerId: 'h2', action: 'analysis', outcome: 'succeeded', analysis: { state: 'not-applicable' }, durationMs: 1_200 }
    ]
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  vi.restoreAllMocks()
})

const analysisReasons = productText['zh-CN'].pages.intelligence.portal.analysisTimeline.failureReasons

const render = async (options?: {
  text?: typeof text
  knownSources?: readonly { sourceId: string; label: string }[]
  analysisFailureReasons?: Readonly<Record<string, string>>
}) => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(SyncRunSection, {
    text: options?.text ?? text,
    analysisFailureReasons: options?.analysisFailureReasons ?? analysisReasons,
    ...(options?.knownSources ? { knownSources: options.knownSources } : {})
  })))
  await act(async () => { await Promise.resolve() })
  return host
}


async function selectAllWindow(host: HTMLElement) {
  const select = host.querySelector('select') as HTMLSelectElement
  await act(async () => {
    select.value = 'all'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

describe('sync run section', () => {
  it('renders the failure in the reader own words, and keeps the code off the surface', async () => {
    const dom = await render()
    expect(dom.textContent).toContain('官方日历排期')
    expect(dom.textContent).toContain('美联储官方日历')
    expect(dom.textContent).toContain(text.allSourcesNote)
    // The sentence, not `provider-disabled`: the raw code lives only in the popover.
    expect(dom.textContent).toContain(text.failureCodes['provider-disabled'])
    expect(dom.textContent).not.toContain('provider-disabled')
    // The code and the raw error text are a sentence built from data, so they are the cell's
    // accessible name: a screen reader gets them, and no unfocusable span pretends to be a control.
    const trigger = dom.querySelector('.mi-sync-run__failure')
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('tabindex')).toBeNull()
    expect(trigger?.getAttribute('aria-label')).toContain('provider-disabled')
    expect(trigger?.getAttribute('aria-label')).toContain('Macro calendar schedule run failed')
    expect(dom.textContent).toContain(text.outcomes.failed)
    expect(dom.textContent).not.toContain('Macro calendar schedule run failed')
    expect(dom.textContent).toContain('32.0s')
  })

  it('falls back to one sentence for a code it does not know', async () => {
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({
      state: 'available',
      rows: [{
        at: '2026-10-30T08:27:20.000Z', runId: 'r2', correlationId: 'r2', taskLabel: '官方日历排期',
        sources: [{ sourceId: 'macro-calendar-fed', label: '美联储官方日历' }],
        handlerId: 'h1', action: 'collect', outcome: 'failed', analysis: { state: 'not-applicable' }, failureCode: 'derived-pragma'
      }]
    })
    const dom = await render()
    expect(dom.textContent).toContain(text.failureUnknown)
    expect(dom.textContent).not.toContain('derived-pragma')
  })

  it('shows the day 31 days ago in the daily totals, where the detail is already gone', async () => {
    vi.spyOn(syncRunClient, 'aggregates').mockResolvedValue({
      state: 'available',
      rows: [{ day: '2026-09-30', handlerId: 'market-intelligence.collectSource', taskLabel: '情报源采集', runs: 6, failures: 1 }]
    })
    const dom = await render()
    await selectAllWindow(dom)

    expect(dom.textContent).toContain(text.aggregates.title)
    expect(dom.textContent).toContain('2026-09-30')
    expect(dom.textContent).toContain('情报源采集')
  })

  it('says why the daily totals cannot be read instead of drawing an empty history', async () => {
    vi.spyOn(syncRunClient, 'aggregates').mockResolvedValue({
      state: 'unavailable',
      reason: 'memory-store-has-no-aggregates',
      rows: []
    })
    const dom = await render()
    await selectAllWindow(dom)

    // A store that keeps no summary is a capability gap, not a failed read: `disabled`, no action.
    expect(dom.querySelector('[data-state="disabled"]')).not.toBeNull()
    expect(dom.querySelector('[data-state="empty"]')).toBeNull()
    expect(dom.querySelector('.state-view__action')).toBeNull()
  })

  it('offers every registered source in the filter, including one that has not run lately', async () => {
    const dom = await render({ knownSources: [{ sourceId: 'github-releases', label: 'GitHub 版本发布' }] })
    const options = [...dom.querySelectorAll('select')[2].querySelectorAll('option')].map((option) => option.textContent)

    expect(options).toContain('GitHub 版本发布')
  })

  it('names a known job in the reader\u2019s language instead of the catalog\u2019s own label', async () => {
    const english = productText['en-US'].settings.intelligenceSources.syncRun
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({
      state: 'available',
      rows: [{
        at: '2026-10-30T08:27:20.000Z', runId: 'r9', correlationId: 'r9', taskLabel: '每日简报',
        sources: [{ sourceId: 'macro-calendar-fed', label: '美联储官方日历' }],
        handlerId: 'market-intelligence.dailyBriefing', action: 'analysis', outcome: 'succeeded', analysis: { state: 'not-applicable' }
      }]
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(SyncRunSection, { text: { ...english, sourceNames: productText['en-US'].settings.intelligenceSources.sourceNames } })))
    await act(async () => { await Promise.resolve() })

    expect(host.textContent).toContain('Daily briefing')
    expect(host.textContent).not.toContain('每日简报')
    expect(host.textContent).toContain(productText['en-US'].settings.intelligenceSources.sourceNames['macro-calendar-fed'])
  })

  it('shows the analysis result beside the task result, and keeps the code until asked', async () => {
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({
      state: 'available',
      rows: [{
        at: '2026-11-06T10:06:03.000Z', runId: 'run-9', correlationId: 'run-9', taskLabel: 'AI 分析',
        sources: [], handlerId: 'market-intelligence.runMarketAnalysis', action: 'analysis', outcome: 'succeeded',
        analysis: {
          state: 'linked',
          result: {
            runId: 'mi-ar-1', state: 'failed', failureCode: 'analysis-provider-error',
            failureDetailCode: 'upstream-aborted', startedAt: '2026-11-06T10:05:02.000Z',
            completedAt: '2026-11-06T10:06:03.000Z', modelProviderId: 'tokenrhythm', modelId: 'deepseek-v4.1-flash-1017'
          }
        }
      }]
    })
    const dom = await render()

    // Two results, both right: the task finished, the analysis it owns did not publish.
    expect(dom.textContent).toContain(text.outcomes.succeeded)
    expect(dom.textContent).toContain(text.analysis.states.failed)
    expect(dom.textContent).toContain(analysisReasons['analysis-provider-error'])
    // The code is diagnosis, so it is not on the row.
    expect(dom.textContent).not.toContain('analysis-provider-error')
    expect(dom.textContent).not.toContain('upstream-aborted')

    const trigger = dom.querySelector('.mi-sync-run__analysis-button') as HTMLButtonElement
    expect(trigger).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const record = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
    expect(record).not.toBeNull()
    expect(record?.textContent).toContain('mi-ar-1')
    expect(record?.textContent).toContain('analysis-provider-error')
    expect(record?.textContent).toContain('upstream-aborted')
    expect(record?.textContent).toContain('tokenrhythm')
  })

  it('says the analysis link is missing instead of drawing it as a dash or a zero', async () => {
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({
      state: 'available',
      rows: [{
        at: '2026-11-06T10:06:03.000Z', runId: 'run-9', correlationId: 'run-9', taskLabel: 'AI 分析',
        sources: [], handlerId: 'market-intelligence.runMarketAnalysis', action: 'analysis', outcome: 'succeeded',
        analysis: { state: 'unlinked' }
      }]
    })
    const dom = await render()

    const note = dom.querySelector('.mi-sync-run__analysis-note')
    expect(note?.textContent).toBe(text.analysis.unlinked)
    expect(note?.textContent).not.toBe(text.analysis.notApplicable)
    expect(note?.textContent).not.toBe('')
    expect(note?.getAttribute('aria-label')).toBe(text.analysis.unlinkedHint)
    // Nothing to open, so it is not a control.
    expect(dom.querySelector('.mi-sync-run__analysis-button')).toBeNull()
  })

  it('marks a task that never produces an analysis without inviting a click', async () => {
    const dom = await render()
    const notes = [...dom.querySelectorAll('.mi-sync-run__analysis-note')]
    expect(notes.some((note) => note.textContent === text.analysis.notApplicable)).toBe(true)
    expect(notes.every((note) => note.getAttribute('aria-label') === text.analysis.notApplicableHint || note.getAttribute('aria-label') === text.analysis.unlinkedHint)).toBe(true)
  })

  it('shows the empty sentence when the window has no runs', async () => {
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({ state: 'available', rows: [] })
    const dom = await render()
    expect(dom.querySelector('[data-state="empty"]')).not.toBeNull()
    // The window is what hid the records, so the way out is widening it.
    expect(dom.querySelector('.state-view__action')).not.toBeNull()
  })

  it('names the failure instead of pretending to load forever', async () => {
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({ state: 'unavailable', failureCode: 'runs-unavailable' })
    const dom = await render()
    expect(dom.querySelector('[data-state="error"]')).not.toBeNull()
    expect(dom.querySelector('.state-view__action')).not.toBeNull()
  })

  it('renders each run in the display time zone, not the machine zone', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () =>
      root!.render(
        createElement(ShellTimeZoneProvider, {
          timeZone: 'Asia/Shanghai',
          children: createElement(SyncRunSection, { text })
        })
      )
    )
    await act(async () => { await Promise.resolve() })
    // 08:27 UTC 显示成 16:27（GMT+8）；同一时刻在机器时区下会写成 08:27。
    expect(host.textContent).toContain('16:27')
    expect(host.textContent).not.toContain('08:27')
  })
})
