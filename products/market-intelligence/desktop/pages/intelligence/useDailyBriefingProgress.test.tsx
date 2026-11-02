// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { useDailyBriefingProgress } from './useDailyBriefingProgress'


let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
})

const running = {
  state: 'running' as const,
  progress: {
    attemptId: '2026-11-02:zh-CN:2026-11-02T01:30:00.000Z',
    startedAt: '2026-11-02T01:30:00.000Z',
    stages: [{ id: 'source' as const, state: 'success' as const, startedAt: '2026-11-02T01:30:00.000Z', durationMs: 300 }]
  }
}

function Harness(props: Readonly<{
  running: boolean
  client: Pick<DailyBriefingClient, 'getProgress'>
  onValue: (value: ReturnType<typeof useDailyBriefingProgress>) => void
}>): null {
  props.onValue(useDailyBriefingProgress({ client: props.client, running: props.running, locale: 'zh-CN', timeZone: 'Asia/Shanghai', intervalMs: 1_000 }))
  return null
}

async function mount(props: Parameters<typeof Harness>[0]): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root?.render(createElement(Harness, props)) })
  return container
}

describe('daily briefing progress polling', () => {
  it('asks once immediately and then every second while a generation runs', async () => {
    vi.useFakeTimers()
    const getProgress = vi.fn(async () => running)
    let seen: ReturnType<typeof useDailyBriefingProgress>
    await mount({ running: true, client: { getProgress }, onValue: (value) => { seen = value } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(getProgress).toHaveBeenCalledTimes(1)
    expect(seen!.state).toBe('running')

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(getProgress).toHaveBeenCalledTimes(4)
    expect(getProgress).toHaveBeenCalledWith({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
  })

  it('stops polling when the generation ends, and forgets the snapshot', async () => {
    vi.useFakeTimers()
    const getProgress = vi.fn(async () => running)
    let seen: ReturnType<typeof useDailyBriefingProgress>
    const container = await mount({ running: true, client: { getProgress }, onValue: (value) => { seen = value } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    const callsWhileRunning = getProgress.mock.calls.length
    expect(callsWhileRunning).toBeGreaterThan(1)

    await act(async () => {
      root?.render(createElement(Harness, { running: false, client: { getProgress }, onValue: (value) => { seen = value } }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getProgress.mock.calls.length).toBe(callsWhileRunning)
    expect(seen!).toBeUndefined()
    expect(container).toBeDefined()
  })

  it('does not start polling at all when nothing is running', async () => {
    vi.useFakeTimers()
    const getProgress = vi.fn(async () => ({ state: 'idle' as const }))
    await mount({ running: false, client: { getProgress }, onValue: () => undefined })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getProgress).not.toHaveBeenCalled()
  })

  it('reports an unreadable answer as unavailable, never as idle', async () => {
    vi.useFakeTimers()
    const getProgress = vi.fn(async () => ({ state: 'unavailable' as const }))
    let seen: ReturnType<typeof useDailyBriefingProgress>
    await mount({ running: true, client: { getProgress }, onValue: (value) => { seen = value } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(seen!).toEqual({ state: 'unavailable' })
  })
})
