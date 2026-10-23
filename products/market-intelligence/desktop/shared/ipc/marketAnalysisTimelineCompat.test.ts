import { expect, it, vi } from 'vitest'
import { marketAnalysisTimelineClient } from './marketAnalysisTimelineClient'

const asOf = '2026-09-28T00:00:00.000Z'
const entry = (extra: Record<string, unknown>) => ({
  id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published',
  occurredAt: asOf, summaryRef: null, safeTitle: '市场分析已生成', safeExcerpt: null, version: 1, ...extra
})

async function readPage(payload: unknown) {
  vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => payload) } } })
  return marketAnalysisTimelineClient.listTimeline({})
}

it('accepts a payload from a main process that does not know the field yet', async () => {
  // The mixed-build case: new renderer, older main. It must degrade, not blank the panel.
  const page = await readPage({ schemaVersion: 1, items: [entry({})], nextCursor: null })
  expect(page.state).toBe('available')
  if (page.state !== 'available') return
  expect(page.page.items).toHaveLength(1)
  expect(page.page.items[0]!.triggerStatus).toBeNull()
})

it('accepts the field when it is present', async () => {
  const page = await readPage({ schemaVersion: 1, items: [entry({ triggerStatus: { triggerKey: 'calendar.refresh', reasonCode: 'interval-active', decidedAt: asOf } })], nextCursor: null })
  expect(page.state).toBe('available')
  if (page.state !== 'available') return
  expect(page.page.items[0]!.triggerStatus).toEqual({ triggerKey: 'calendar.refresh', reasonCode: 'interval-active', decidedAt: asOf })
})

it('still rejects a payload with genuinely unknown keys', async () => {
  expect((await readPage({ schemaVersion: 1, items: [entry({ injected: 'x' })], nextCursor: null })).state).toBe('unavailable')
  expect((await readPage({ schemaVersion: 1, items: [entry({ triggerStatus: 'nope' })], nextCursor: null })).state).toBe('available')
  expect((await readPage({ schemaVersion: 1, items: [entry({ triggerStatus: { reasonCode: 'interval-active' } })], nextCursor: null })).state).toBe('available')
})
