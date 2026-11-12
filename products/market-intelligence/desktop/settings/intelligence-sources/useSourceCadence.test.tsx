// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { notifySettingsRevision } from '../../shared/events/settingsRevision'
import { useSourceCadence } from './useSourceCadence'

/**
 * 频率读数的取数纪律（用户 2026-11-13）：**一次全量读**、随 `sources` 域信号重读、
 * 不轮询、不在每次渲染里读；读不到时整批按「读不到」表示（不把 44 个源画成「未安排」）。
 */
let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

type Probe = { reads: () => number; available: () => boolean; sources: () => string[] }

async function mountProbe(): Promise<Probe> {
  const probe: Probe = { reads: () => 0, available: () => false, sources: () => [] }
  function Host(): null {
    const state = useSourceCadence()
    probe.available = () => state.available
    probe.sources = () => Object.keys(state.bySource)
    return null
  }
  root = createRoot(document.createElement('div'))
  await act(async () => { root!.render(createElement(Host)); await Promise.resolve() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return probe
}

function installBridge(result?: () => Promise<unknown>): { reads: () => number } {
  let reads = 0
  const listSchedules = vi.fn(async () => {
    reads += 1
    if (result !== undefined) return result()
    return [
      {
        id: 'market-intelligence.collect:coindesk-rss',
        trigger: { kind: 'interval', intervalMs: 900_000, anchor: 'lastComplete' },
        nextRunAt: '2026-12-01T06:30:00.000Z',
        lastRunAt: '2026-12-01T06:15:00.000Z',
        lastRunStatus: 'completed'
      }
    ]
  })
  ;(window as unknown as { platform: unknown }).platform = { jobs: { listSchedules } }
  return { reads: () => reads }
}

describe('频率读数的取数', () => {
  it('reads once on mount and maps the schedules onto sources', async () => {
    const bridge = installBridge()
    const probe = await mountProbe()

    expect(bridge.reads()).toBe(1)
    expect(probe.available()).toBe(true)
    expect(probe.sources()).toEqual(['coindesk-rss'])
  })

  it('re-reads when the sources domain changes — no polling', async () => {
    const bridge = installBridge()
    await mountProbe()

    await act(async () => { notifySettingsRevision('sources', 'another-place') })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(bridge.reads()).toBe(2)

    // 与本域无关的信号不重读。
    await act(async () => { notifySettingsRevision('briefing', 'another-place') })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(bridge.reads()).toBe(2)
  })

  it('says the schedule is unavailable when the bridge is missing, instead of "nothing is scheduled"', async () => {
    const probe = await mountProbe()
    expect(probe.available()).toBe(false)
    expect(probe.sources()).toEqual([])
  })

  it('treats a failed read as unavailable, not as an empty schedule', async () => {
    installBridge(async () => { throw new Error('ipc failed') })
    const probe = await mountProbe()
    expect(probe.available()).toBe(false)
    expect(probe.sources()).toEqual([])
  })
})
