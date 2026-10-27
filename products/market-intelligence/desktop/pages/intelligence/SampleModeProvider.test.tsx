// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { SampleModeClient, SampleModeState } from '../../shared/ipc/sampleModeClient'
import { SampleModeProvider, useSampleMode } from './SampleModeProvider'

const live: SampleModeState = { active: false, scenarioCount: 1 }
const sample: SampleModeState = {
  active: true,
  scenarioId: 's1',
  scenarioNow: '2026-10-24T20:00:00.000Z',
  locale: 'zh-CN',
  scenarioCount: 1
}

function client(initial: SampleModeState): SampleModeClient & { calls: boolean[] } {
  const calls: boolean[] = []
  return {
    calls,
    getState: async () => initial,
    setActive: async (active) => {
      calls.push(active)
      return active ? sample : live
    }
  }
}

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true })

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

function renderProbe(fake: SampleModeClient): { read: () => ReturnType<typeof useSampleMode> } {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  let current: ReturnType<typeof useSampleMode> | undefined
  function Probe(): null {
    current = useSampleMode()
    return null
  }
  act(() => root!.render(<SampleModeProvider client={fake}><Probe /></SampleModeProvider>))
  return { read: () => current! }
}

describe('SampleModeProvider', () => {
  it('keeps the real clock and the live key until the sample is entered', async () => {
    const probe = renderProbe(client(live))
    await act(async () => { await Promise.resolve() })
    expect(probe.read().sessionKey).toBe('live')
    expect(Math.abs(probe.read().now().getTime() - Date.now())).toBeLessThan(2_000)
  })

  it('pins the clock to the scenario instant and re-keys the panels once active', async () => {
    const fake = client(live)
    const probe = renderProbe(fake)
    await act(async () => { await probe.read().enter() })
    expect(fake.calls).toEqual([true])
    expect(probe.read().state.active).toBe(true)
    expect(probe.read().now().toISOString()).toBe(sample.scenarioNow)
    expect(probe.read().sessionKey).toBe(`s1:${sample.scenarioNow}:${sample.locale}`)
  })

  it('returns to the real clock after exiting', async () => {
    const probe = renderProbe(client(sample))
    await act(async () => { await Promise.resolve() })
    expect(probe.read().state.active).toBe(true)
    await act(async () => { await probe.read().exit() })
    expect(probe.read().state.active).toBe(false)
    expect(probe.read().sessionKey).toBe('live')
  })
})
