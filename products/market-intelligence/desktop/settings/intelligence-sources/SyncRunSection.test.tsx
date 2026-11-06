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

const ROWS = [
      { at: '2026-10-30T08:27:20.000Z', runId: 'r1', correlationId: 'r1', taskLabel: '官方日历排期', sources: [{ sourceId: 'macro-calendar-fed', label: '美联储官方日历' }], handlerId: 'h1', action: 'collect', outcome: 'failed', analysis: { state: 'not-applicable' }, durationMs: 32_000, failureCode: 'provider-disabled', detail: 'Macro calendar schedule run failed: provider-disabled' },
      { at: '2026-10-30T08:25:00.000Z', runId: 'r2', correlationId: 'r2', taskLabel: 'AI 分析', sources: [], handlerId: 'h2', action: 'analysis', outcome: 'succeeded', analysis: { state: 'not-applicable' }, durationMs: 1_200 }
] as const

beforeEach(() => {
  vi.spyOn(syncRunClient, 'list').mockResolvedValue({ state: 'available', rows: ROWS })
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
  focusAnalysisRunId?: string
}) => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(SyncRunSection, {
    text: options?.text ?? text,
    analysisFailureReasons: options?.analysisFailureReasons ?? analysisReasons,
    ...(options?.knownSources ? { knownSources: options.knownSources } : {}),
    ...(options?.focusAnalysisRunId === undefined ? {} : { focusAnalysisRunId: options.focusAnalysisRunId })
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

function analysisRow(input: {
  runId: string
  at: string
  analysisRunId: string
}) {
  return {
    at: input.at, runId: input.runId, correlationId: input.runId, taskLabel: 'AI 分析',
    sources: [], handlerId: 'market-intelligence.runMarketAnalysis', action: 'analysis' as const,
    outcome: 'succeeded' as const,
    analysis: {
      state: 'linked' as const,
      result: {
        runId: input.analysisRunId, state: 'failed' as const, failureCode: 'analysis-provider-error',
        startedAt: input.at, completedAt: input.at, modelProviderId: 'tokenrhythm', modelId: 'deepseek-v4.1-flash-1017'
      }
    }
  }
}

describe('sync run section', () => {
  it('sends the task filter to the server and keeps the options from the catalogue', async () => {
    // 选项从「已加载的行」生成的话，选完一个任务，其它任务就从下拉里消失——读者回不去。
    const dom = await render()
    const taskSelect = dom.querySelectorAll('select')[1] as HTMLSelectElement
    expect(taskSelect.options.length).toBeGreaterThan(2)

    // 选项来自目录（`text.tasks`），所以选一个真实的任务 id；用假 id 赋值会静默不生效。
    const handlerId = 'market-intelligence.translateItems'
    await act(async () => {
      taskSelect.value = handlerId
      taskSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    // 稀疏任务（翻译一天 45 次）必须由服务端筛，否则它永远排在采集记录之后、取不回来。
    expect(vi.mocked(syncRunClient.list).mock.calls.at(-1)?.[0]).toMatchObject({ handlerId })
  })

  it('says how much of the window the CSV left out instead of exporting silently', async () => {
    // 页面上写着「还有更多」，导出却像是全量——这就是最容易被当成丢数据的那种不一致。
    vi.mocked(syncRunClient.list).mockResolvedValue({ state: 'available', rows: ROWS, truncated: true })
    const writeText = vi.fn(async () => undefined)
    // `navigator.clipboard` 只有 getter，赋值会抛；用 defineProperty 换掉这一属性。
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const dom = await render()
    const exportButton = [...dom.querySelectorAll('button')].find((button) => button.textContent === text.exportCsv)
    expect(exportButton).toBeDefined()
    await act(async () => {
      exportButton!.click()
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalled()
    expect(dom.textContent).toContain(text.exportTruncated.replace('{count}', String(ROWS.length)))
  })

  it('makes “no source” its own filter instead of letting the empty value stand for it', async () => {
    const dom = await render()
    const sourceSelect = dom.querySelectorAll('select')[2] as HTMLSelectElement
    const noSource = [...sourceSelect.options].find((option) => option.textContent === text.sourceFilterNone)
    expect(noSource).toBeDefined()
    expect(noSource!.value).not.toBe('')

    await act(async () => {
      sourceSelect.value = noSource!.value
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    // 只剩没有来源的那条：有来源那行的失败码不再出现在页面上。
    expect(dom.textContent).not.toContain(text.failureCodes['provider-disabled'])
  })

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

  it('says how many items a batch ran and how they ended, in one cell', async () => {
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({
      state: 'available',
      rows: [{
        at: '2026-10-30T08:27:20.000Z', runId: 'r-counts', correlationId: 'r-counts',
        taskLabel: '翻译任务', sources: [{ sourceId: 'coindesk-rss', label: 'CoinDesk' }],
        handlerId: 'market-intelligence.translateItems', action: 'other', outcome: 'succeeded', durationMs: 2_000,
        analysis: { state: 'not-applicable' as const },
        counts: { total: 6, succeeded: 5, failed: 1, skipped: 0 }, resultReasonCode: 'translation.rate-limited'
      }]
    })
    const dom = await render()
    expect(dom.textContent).toContain('6 条中成功 5')
    expect(dom.textContent).toContain('失败 1')
    // One sentence for the reason, never a breakdown the page would have to invent.
    expect(dom.textContent).toContain(text.resultReasons['translation.rate-limited']!)
    expect(dom.textContent).not.toContain('translation.rate-limited')
  })

  it('writes no numbers for a run that predates the tally, and says so once for the table', async () => {
    const dom = await render()
    // The fixture runs carry no tally: no zeroes anywhere, and the old-record sentence appears once.
    expect(dom.textContent).not.toContain('0 条中成功')
    const notes = [...dom.querySelectorAll('.mi-sync-run__legend--tally')]
    expect(notes).toHaveLength(1)
    expect(notes[0]?.textContent).toBe(text.oldRecordNote)
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

  it('locates the analysis a notification pointed at, opens its record and marks the row', async () => {
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({
      state: 'available',
      rows: [
        analysisRow({ runId: 'run-2', at: '2026-11-06T10:10:00.000Z', analysisRunId: 'mi-ar-other' }),
        analysisRow({ runId: 'run-1', at: '2026-11-06T10:05:00.000Z', analysisRunId: 'mi-ar-target' })
      ]
    })
    const dom = await render({ focusAnalysisRunId: 'mi-ar-target' })

    const focused = dom.querySelector('[data-focused="true"]')
    expect(focused).not.toBeNull()
    expect(focused?.getAttribute('data-analysis-run-id')).toBe('mi-ar-target')
    // 定位同时打开那次的记录，并把键盘焦点放到它的展开按钮上。
    const trigger = focused?.querySelector<HTMLButtonElement>('.mi-sync-run__analysis-button')
    expect(trigger?.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(trigger)
    expect(dom.querySelector('.mi-sync-run__focus-missing')).toBeNull()
  })

  it('finds the row even when it sits past the first page', async () => {
    // 30 条一页；目标在第 31 条（第 2 页）。定位不能假设它在第一页。
    const rows = Array.from({ length: 31 }, (_unused, index) =>
      analysisRow({
        runId: `run-${index}`,
        at: new Date(Date.parse('2026-11-06T10:00:00.000Z') - index * 60_000).toISOString(),
        analysisRunId: index === 30 ? 'mi-ar-last' : `mi-ar-${index}`
      })
    )
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({ state: 'available', rows })
    const dom = await render({ focusAnalysisRunId: 'mi-ar-last' })

    expect(dom.querySelector('[data-focused="true"]')?.getAttribute('data-analysis-run-id')).toBe('mi-ar-last')
    // 分页在翻到那一页：第 2 页的页码文字。
    expect(dom.textContent).toContain(text.page.replace('{page}', '2').replace('{pages}', '2'))
  })

  it('says the record was not found instead of stopping silently at the top', async () => {
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({
      state: 'available',
      rows: [analysisRow({ runId: 'run-1', at: '2026-11-06T10:05:00.000Z', analysisRunId: 'mi-ar-other' })]
    })
    const dom = await render({ focusAnalysisRunId: 'mi-ar-missing' })

    const note = dom.querySelector('.mi-sync-run__focus-missing')
    expect(note).not.toBeNull()
    expect(note?.textContent).toContain(text.focus.missing)
    expect(note?.textContent).toContain(text.focus.missingHint)
    expect(note?.getAttribute('role')).toBe('status')
    // The list is still there: "not found" must not replace "what is there".
    expect(dom.querySelector('[data-analysis-run-id="mi-ar-other"]')).not.toBeNull()
    expect(dom.querySelector('[data-focused="true"]')).toBeNull()
  })

  it('treats a malformed or tampered id as not found instead of crashing', async () => {
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({
      state: 'available',
      rows: [analysisRow({ runId: 'run-1', at: '2026-11-06T10:05:00.000Z', analysisRunId: 'mi-ar-other' })]
    })
    const dom = await render({ focusAnalysisRunId: '"><script>alert(1)</script>' })

    expect(dom.querySelector('.mi-sync-run__focus-missing')?.textContent).toContain(text.focus.missing)
    expect(dom.querySelector('[data-focused="true"]')).toBeNull()
    expect(dom.querySelector('script')).toBeNull()
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
