// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'

import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'
import { DailyBriefingLiveSteps } from './DailyBriefingLiveSteps'
import type { DailyBriefingText } from './dailyBriefingText'
import { productText } from '../../shared/i18n/productText'


const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing as unknown as DailyBriefingText

let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const startedAt = '2026-11-02T01:30:00.000Z'
const progress: BriefingGenerationProgress = {
  attemptId: '2026-11-02:zh-CN',
  startedAt,
  stages: [
    { id: 'source', state: 'success', startedAt, finishedAt: '2026-11-02T01:30:01.000Z', durationMs: 1_000 },
    { id: 'candidates', state: 'success', startedAt, finishedAt: '2026-11-02T01:30:02.000Z', durationMs: 1_000 },
    { id: 'selection', state: 'pending', startedAt: '2026-11-02T01:30:02.000Z' },
    { id: 'field-backfill', state: 'pending' },
    { id: 'writing', state: 'pending' },
    { id: 'validation', state: 'pending' },
    { id: 'repair-1', state: 'pending' },
    { id: 'repair-2', state: 'pending' },
    { id: 'store', state: 'pending' }
  ]
}

async function render(input: BriefingGenerationProgress, nowMs: number): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root?.render(createElement(DailyBriefingLiveSteps, { progress: input, text, nowMs, resolveText: (key: string) => key })) })
  return container
}

const rowState = (container: HTMLElement, step: string): string | null =>
  container.querySelector(`[data-step="${step}"]`)?.getAttribute('data-step-state') ?? null

it('shows eight rows from the contract, folding the two repair rounds into one', async () => {
  const container = await render(progress, Date.parse('2026-11-02T01:30:12.000Z'))
  const rows = container.querySelectorAll('[data-step]')
  expect(rows).toHaveLength(8)
  expect([...rows].map((row) => row.getAttribute('data-step'))).toEqual([
    'source', 'candidates', 'selection', 'field-backfill', 'writing', 'validation', 'repair', 'store'
  ])
  // The two rounds are one row, named by the copy table rather than by the stage id.
  expect(container.querySelector('[data-step="repair"]')!.textContent).toContain('修正')
})

it('marks what finished, what is running and what has not started', async () => {
  const nowMs = Date.parse('2026-11-02T01:30:42.000Z')
  const container = await render(progress, nowMs)
  expect(rowState(container, 'source')).toBe('done')
  expect(rowState(container, 'candidates')).toBe('done')
  expect(rowState(container, 'selection')).toBe('running')
  expect(rowState(container, 'writing')).toBe('waiting')
  // A started stage shows elapsed time, which is the only "progress" a single model call can report.
  expect(container.querySelector('[data-step="selection"]')!.textContent).toContain('已用 0:40')
  expect(container.querySelector('[data-step="writing"]')!.textContent).toContain('等待')
})

it('never invents a duration or a percentage', async () => {
  const container = await render(progress, Date.parse('2026-11-02T01:30:42.000Z'))
  // A stage that has begun without a timestamp cannot claim an elapsed time.
  const noTimestamp = { ...progress, stages: progress.stages.map((stage) => (stage.id === 'selection' ? { id: stage.id, state: 'pending' as const } : stage)) }
  const second = await render(noTimestamp, Date.parse('2026-11-02T01:30:42.000Z'))
  expect(second.querySelector('[data-step="selection"]')!.textContent).not.toContain('已用')
  expect(container.textContent).not.toMatch(/\d+%/)
  // The long explanation moved behind the help trigger: it must not sit on the page.
  expect(container.querySelector('[data-live-steps-note]')).toBeNull()
  const help = container.querySelector('[data-steps-help]')
  expect(help).not.toBeNull()
  // The trigger sits before the title it explains, and before the list, so the visual order and the
  // keyboard order are the same one.
  const head = container.querySelector('.mi-brief-steps__head')!
  // The popover wraps its trigger in an anchor; the anchor is the first child, the title second.
  expect(head.firstElementChild!.contains(help)).toBe(true)
  expect(head.firstElementChild!.nextElementSibling?.tagName.toLowerCase()).toBe('h3')
  expect(head.textContent).toContain(text.generationProgress.title)
  expect(head.compareDocumentPosition(container.querySelector('ol')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('says a skipped-only row was not needed instead of claiming it succeeded', async () => {
  const skipped = {
    ...progress,
    stages: progress.stages.map((stage) => (stage.id === 'repair-1' || stage.id === 'repair-2' ? { id: stage.id, state: 'skipped' as const } : stage))
  }
  const container = await render(skipped, Date.parse('2026-11-02T01:30:12.000Z'))
  expect(rowState(container, 'repair')).toBe('not-needed')
  expect(container.querySelector('[data-step="repair"]')!.textContent).toContain(text.generationTrace.states.notNeeded)
})
