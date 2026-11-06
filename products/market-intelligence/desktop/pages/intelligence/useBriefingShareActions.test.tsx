// @vitest-environment happy-dom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import { useBriefingShareActions } from './useBriefingShareActions'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const briefing = {
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: { date: '2026-11-02', windowStart: '2026-11-01T00:00:00.000Z', windowEnd: '2026-11-01T23:00:00.000Z', windowHours: 24, generatedAt: '2026-11-01T23:05:00.000Z', locale: 'zh-CN' },
  lede: { text: 'x' },
  news: { items: [], macro: [] },
  sections: {}
} as unknown as DailyBriefingDocument

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

type Actions = ReturnType<typeof useBriefingShareActions>

function render(document: DailyBriefingDocument | undefined, shareRef = createRef<HTMLDivElement>()) {
  let latest: Actions | undefined
  const Probe = (): null => {
    latest = useBriefingShareActions({ document, locale: 'zh-CN', text, shareRef })
    return null
  }
  act(() => root.render(<Probe />))
  return { actions: () => latest!, shareRef }
}

describe('briefing share actions', () => {
  it('does nothing without an edition to share', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { actions } = render(undefined)

    await act(async () => { await actions().copy() })

    expect(writeText).not.toHaveBeenCalled()
    expect(actions().copyState).toBe('idle')
  })

  it('reports a clipboard failure without claiming the text was copied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied') } } })
    const { actions } = render(briefing)

    await act(async () => { await actions().copy() })

    expect(actions().copyState).toBe('failed')
  })

  it('does not try to export when there is nothing on screen', async () => {
    const { actions, shareRef } = render(undefined)
    shareRef.current = document.createElement('div')

    await act(async () => { await actions().exportImage() })

    expect(actions().exportState).toBe('idle')
  })
})
