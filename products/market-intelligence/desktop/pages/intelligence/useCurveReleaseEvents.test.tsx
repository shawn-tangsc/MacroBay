// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCurveReleaseEvents } from './useCurveReleaseEvents'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'

type Read = (month: string, asOf: string) => Promise<readonly unknown[] | null>

const AS_OF = '2026-11-13T00:00:00.000Z'

function Probe({ read, windowStart, windowEnd, enabled = true, asOf = AS_OF, locale = 'zh-CN' }: Readonly<{
  read?: Read
  windowStart?: string
  windowEnd?: string
  enabled?: boolean
  asOf?: string
  locale?: string
}>): React.ReactElement {
  // 只给 hook 它认识的那一段：窗口端点来自序列首尾。
  const reading = windowStart && windowEnd
    ? ({ probability: { series: [{ at: windowStart }, { at: windowEnd }] } } as unknown as PolicyPathReading)
    : undefined
  const events = useCurveReleaseEvents({
    enabled,
    ...(read ? { readCalendarMonth: async (month: string, at: string) => { const events = await read(month, at); return events === null ? null : { events: events as never, sources: [] } } } : {}),
    asOf,
    locale,
    ...(reading ? { reading } : {})
  })
  return <output>{events.map((event) => `${event.at}|${event.label}`).join(',')}</output>
}

let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.innerHTML = ''
})

async function mount(props: Parameters<typeof Probe>[0]): Promise<string> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root!.render(<Probe {...props} />) })
  return host.querySelector('output')?.textContent ?? ''
}

describe('curve release events', () => {
  it('reads every month the curve covers and keeps the calendar titles', async () => {
    const read = vi.fn<Read>(async (month) => month === '2026-10'
      ? [{ scheduledAt: '2026-10-31T12:00:00.000Z', title: 'CPI 年率' }]
      : [{ scheduledAt: '2026-11-06T13:30:00.000Z', title: '新增就业' }])
    const text = await mount({ read, windowStart: '2026-10-30T00:00:00.000Z', windowEnd: '2026-11-12T00:00:00.000Z' })
    expect(read.mock.calls.map(([month]) => month)).toEqual(['2026-10', '2026-11'])
    expect(text).toBe('2026-10-31T12:00:00.000Z|CPI 年率,2026-11-06T13:30:00.000Z|新增就业')
  })

  it('drops repeated rows and rows without a usable instant or name', async () => {
    const read: Read = async () => [
      { scheduledAt: '2026-11-06T13:30:00.000Z', title: '新增就业' },
      { scheduledAt: '2026-11-06T13:30:00.000Z', title: '新增就业' },
      { scheduledAt: 'not-a-time', title: '坏时刻' },
      { scheduledAt: '2026-11-07T13:30:00.000Z' }
    ]
    const text = await mount({ read, windowStart: '2026-11-01T00:00:00.000Z', windowEnd: '2026-11-12T00:00:00.000Z' })
    expect(text).toBe('2026-11-06T13:30:00.000Z|新增就业')
  })

  it('does not read the calendar while the drawer is closed', async () => {
    const read = vi.fn<Read>(async () => [])
    await mount({ read, windowStart: '2026-11-01T00:00:00.000Z', windowEnd: '2026-11-12T00:00:00.000Z', enabled: false })
    expect(read).not.toHaveBeenCalled()
  })

  it('queries with the reading snapshot instant, never a fresh clock', async () => {
    const read = vi.fn<Read>(async () => [])
    await mount({ read, windowStart: '2026-11-01T00:00:00.000Z', windowEnd: '2026-11-12T00:00:00.000Z' })
    expect(read.mock.calls.every(([, at]) => at === AS_OF)).toBe(true)
  })

  it('does not read again for the same snapshot and window, even when the reader identity changes', async () => {
    const read = vi.fn<Read>(async () => [])
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const props = { read, windowStart: '2026-11-01T00:00:00.000Z', windowEnd: '2026-11-12T00:00:00.000Z' }
    await act(async () => { root!.render(<Probe {...props} />) })
    const calls = read.mock.calls.length
    // 新函数身份、同一快照：hover/重渲染不许再打一次——新的那个也不许被调用。
    const second = vi.fn<Read>(async () => [])
    await act(async () => { root!.render(<Probe {...props} read={second} />) })
    expect(read.mock.calls.length).toBe(calls)
    expect(second).not.toHaveBeenCalled()
  })

  it('re-reads when the language changes', async () => {
    const read = vi.fn<Read>(async () => [])
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const base = { read, windowStart: '2026-11-01T00:00:00.000Z', windowEnd: '2026-11-12T00:00:00.000Z' }
    await act(async () => { root!.render(<Probe {...base} locale="zh-CN" />) })
    const calls = read.mock.calls.length
    await act(async () => { root!.render(<Probe {...base} locale="en-US" />) })
    expect(read.mock.calls.length).toBeGreaterThan(calls)
  })

  it('treats a failed read as no events — the annotation layer never breaks the curve', async () => {
    const text = await mount({
      read: async () => { throw new Error('offline') },
      windowStart: '2026-11-01T00:00:00.000Z',
      windowEnd: '2026-11-12T00:00:00.000Z'
    })
    expect(text).toBe('')
  })
})
