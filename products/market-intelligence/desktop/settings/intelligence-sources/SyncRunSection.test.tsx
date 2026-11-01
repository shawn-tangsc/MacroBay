// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { syncRunClient } from '../../shared/ipc/syncRunClient'
import { SyncRunSection } from './SyncRunSection'

const text = productText['zh-CN'].settings.intelligenceSources.syncRun
let root: Root | undefined
let host: HTMLDivElement | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  vi.spyOn(syncRunClient, 'list').mockResolvedValue({
    state: 'available',
    rows: [
      { at: '2026-10-30T08:27:20.000Z', runId: 'r1', correlationId: 'r1', taskLabel: '官方日历排期', sources: [{ sourceId: 'macro-calendar-fed', label: '美联储官方日历' }], handlerId: 'h1', action: 'collect', outcome: 'failed', durationMs: 32_000, failureCode: 'provider-disabled', detail: 'Macro calendar schedule run failed: provider-disabled' },
      { at: '2026-10-30T08:25:00.000Z', runId: 'r2', correlationId: 'r2', taskLabel: 'AI 分析', sources: [], handlerId: 'h2', action: 'analysis', outcome: 'succeeded', durationMs: 1_200 }
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

const render = async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(SyncRunSection, { text })))
  await act(async () => { await Promise.resolve() })
  return host
}

describe('sync run section', () => {
  it('renders the failure in the reader own words, and keeps the code off the surface', async () => {
    const dom = await render()
    expect(dom.textContent).toContain('官方日历排期')
    expect(dom.textContent).toContain('美联储官方日历')
    expect(dom.textContent).toContain(text.allSourcesNote)
    // The sentence, not `provider-disabled`: the raw code lives only in the title.
    expect(dom.textContent).toContain(text.failureCodes['provider-disabled'])
    expect(dom.textContent).not.toContain('provider-disabled')
    // The code and the raw error text are both reachable by hovering, neither is printed.
    expect(dom.querySelector('[title^="错误码：provider-disabled"]')).not.toBeNull()
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
        handlerId: 'h1', action: 'collect', outcome: 'failed', failureCode: 'derived-pragma'
      }],
      window: '24h', generatedAt: '2026-10-30T09:00:00.000Z'
    })
    const dom = await render()
    expect(dom.textContent).toContain(text.failureUnknown)
    expect(dom.textContent).not.toContain('derived-pragma')
  })

  it('names a known job in the reader\u2019s language instead of the catalog\u2019s own label', async () => {
    const english = productText['en-US'].settings.intelligenceSources.syncRun
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({
      state: 'available',
      rows: [{
        at: '2026-10-30T08:27:20.000Z', runId: 'r9', correlationId: 'r9', taskLabel: '每日简报',
        sources: [{ sourceId: 'macro-calendar-fed', label: '美联储官方日历' }],
        handlerId: 'market-intelligence.dailyBriefing', action: 'analysis', outcome: 'succeeded'
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

  it('shows the empty sentence when the window has no runs', async () => {
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({ state: 'available', rows: [] })
    const dom = await render()
    expect(dom.textContent).toContain(text.empty)
  })

  it('names the failure instead of pretending to load forever', async () => {
    vi.spyOn(syncRunClient, 'list').mockResolvedValue({ state: 'unavailable', failureCode: 'runs-unavailable' })
    const dom = await render()
    expect(dom.textContent).toContain(text.unavailable)
  })
})
