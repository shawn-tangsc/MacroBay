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
      { at: '2026-10-30T08:27:20.000Z', runId: 'r1', sourceId: 'macro-calendar-fed', sourceLabel: '官方日历排期', handlerId: 'h1', action: 'collect', outcome: 'failed', durationMs: 32_000, failureCode: 'provider-disabled', detail: 'Macro calendar schedule run failed: provider-disabled' },
      { at: '2026-10-30T08:25:00.000Z', runId: 'r2', sourceLabel: 'FRED 利率', handlerId: 'h2', action: 'collect', outcome: 'succeeded', durationMs: 1_200 }
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
  it('renders the failure code and the outcome, not just a count', async () => {
    const dom = await render()
    expect(dom.textContent).toContain('官方日历排期')
    expect(dom.textContent).toContain('provider-disabled')
    expect(dom.textContent).toContain(text.outcomes.failed)
    expect(dom.textContent).toContain('32.0s')
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
