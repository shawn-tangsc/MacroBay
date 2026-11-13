// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCurveReleaseEvents } from './useCurveReleaseEvents'

type Read = (month: string, asOf: string) => Promise<readonly unknown[] | null>

function Probe({ read, windowStart, windowEnd, enabled = true }: Readonly<{
  read?: Read
  windowStart?: string
  windowEnd?: string
  enabled?: boolean
}>): React.ReactElement {
  const events = useCurveReleaseEvents({
    enabled,
    ...(read ? { readMarketEvents: read } : {}),
    ...(windowStart ? { windowStart } : {}),
    ...(windowEnd ? { windowEnd } : {})
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

  it('treats a failed read as no events — the annotation layer never breaks the curve', async () => {
    const text = await mount({
      read: async () => { throw new Error('offline') },
      windowStart: '2026-11-01T00:00:00.000Z',
      windowEnd: '2026-11-12T00:00:00.000Z'
    })
    expect(text).toBe('')
  })
})
