// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { SourceHealthDetail } from './SourceHealthDetail'
import type { SourceDetailRead } from './SourceHealthDetail'
import type { SourceView } from '../../../service/intelligence/application/sourceProjection'

const text = productText['zh-CN'].settings.intelligenceSources

let root: Root | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

function source(overrides: Partial<SourceView> = {}): SourceView {
  return {
    sourceId: 's1',
    providerId: 'p1',
    displayName: 'S1',
    agents: ['crypto'],
    panels: ['dashboard'],
    visibility: 'visible',
    collection: 'adapter',
    kind: 'feed',
    capabilities: { runNow: 'adapter', testConnection: true },
    readiness: 'live',
    enabled: true,
    healthState: 'healthy',
    healthMarker: 'none',
    ...overrides
  }
}

function labels() {
  return { ...text.health, reasons: text.health.reasons, runNow: text.health.runNow }
}

async function render(read: SourceDetailRead, extra: { source?: SourceView; supportsRunNow?: boolean; onRetry?: () => void } = {}): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(SourceHealthDetail, {
      automaticSyncStopped: text.automaticSyncStopped,
      labels: labels(),
      onRetry: extra.onRetry ?? (() => {}),
      read,
      resolveText: (key: string) => key === 'settings.intelligenceSources.unavailableReasonCodeAria'
        ? '原因码'
        : (text as unknown as Record<string, string>)[key] ?? '',
      source: extra.source ?? source(),
      ...(extra.supportsRunNow === undefined ? {} : { supportsRunNow: extra.supportsRunNow }),
      timeZone: 'Asia/Shanghai'
    }))
  })
  return container
}

const ready = (health: Record<string, unknown>, rest: Record<string, unknown> = {}): SourceDetailRead => ({
  state: 'ready',
  // 只带四格要用的三个字段；组件不读别的。
  detail: { health, ...rest } as never
})

describe('source health detail (B4)', () => {
  it('draws four cells: today, last success, why it is not collecting, can it run now', async () => {
    const container = await render(ready({ lastSuccessAt: '2026-11-09T04:00:00.000Z' }), { supportsRunNow: true })

    const cells = [...container.querySelectorAll<HTMLElement>('[data-health-cell]')].map((cell) => cell.getAttribute('data-health-cell'))
    expect(cells).toEqual(['today', 'last-success', 'idle-reason', 'run-now'])
    expect(container.textContent).toContain(text.health.todayReading)
    expect(container.textContent).toContain(text.health.todayReadingNo)
    expect(container.textContent).toContain('11-09 12:00 GMT+8')
    expect(container.textContent).toContain(text.health.reasons.collecting)
    expect(container.textContent).toContain(text.health.runNow.yes)
  })

  it('falls back to "unknown" and says why, instead of painting a calendar feed as never collected', async () => {
    // 日历 feed 不读通用详情：`skipped` 不是失败，也不是「没有」。
    const container = await render({ state: 'skipped' })
    expect(container.textContent).toContain(text.health.unknown)
    expect(container.textContent).toContain(text.health.unknownReason)
    expect(container.querySelectorAll('[data-health-cell]')).toHaveLength(4)
    expect(container.querySelector('.state-view')).toBeNull()
  })

  it('puts the unavailable reason and the last success in the cells, with the reason code only in the ⓘ', async () => {
    const container = await render(ready({}), {
      source: source({
        collection: 'provider',
        unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped', lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z', decidedAt: '2026-11-08' }
      })
    })
    expect(container.textContent).toContain('官方源暂时不可用（403）')
    expect(container.textContent).toContain(text.automaticSyncStopped)
    expect(container.textContent).toContain('10-22 15:29 GMT+8')
    expect(container.textContent).not.toContain('official-endpoint-returned-403')
    expect(container.querySelectorAll('[aria-label="原因码"]')).toHaveLength(1)
  })

  it('says a missing credential blocks both collecting and running now', async () => {
    const container = await render(ready({}, { credentialStatus: { hasCredential: false }, profile: { collectionPreset: 'balanced' } }), { supportsRunNow: true })
    expect(container.textContent).toContain(text.health.reasons['missing-credential'])
    expect(container.textContent).toContain(text.health.runNow['missing-credential'])
  })

  it('turns a failed read into an error with a retry, never into "nothing yet today"', async () => {
    const onRetry = vi.fn()
    const container = await render({ state: 'failed' }, { onRetry })

    expect(container.querySelector('.state-view')).not.toBeNull()
    expect(container.querySelectorAll('[data-health-cell]')).toHaveLength(0)
    expect(container.textContent).not.toContain(text.health.todayReadingNo)
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === '重试')
    await act(async () => { retry?.click() })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('draws nothing while the detail is still being read', async () => {
    const container = await render({ state: 'loading' })
    expect(container.innerHTML).toBe('')
  })
})
