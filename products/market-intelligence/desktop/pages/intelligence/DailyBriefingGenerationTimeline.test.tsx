// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { DailyBriefingGenerationTimeline } from './DailyBriefingGenerationTimeline'
import {
  readGenerationTrace,
  type GenerationStageId,
  type GenerationStageState,
  type GenerationTrace,
  type GenerationTraceStage
} from './dailyBriefingGenerationTrace'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const englishText = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing
// Mirrors the shell formatter's `YYYY-MM-DD HH:mm[:ss]` shape so the same-day rule is exercised.
const formatTime = (value: string, precision: 'minute' | 'second' = 'minute'): string =>
  `${value.slice(0, 10)} ${value.slice(11, precision === 'second' ? 19 : 16)}`

function stage(
  id: GenerationStageId,
  state: GenerationStageState,
  overrides: Partial<GenerationTraceStage> = {}
): GenerationTraceStage {
  return {
    id, state,
    ...(state === 'pending' ? {} : {
      startedAt: '2026-10-30T00:00:05.000Z',
      finishedAt: '2026-10-30T00:00:06.000Z',
      durationMs: 1_000
    }),
    ...overrides
  }
}

function trace(
  state: GenerationTrace['state'],
  stages: readonly GenerationTraceStage[],
  overrides: Partial<GenerationTrace> = {}
): GenerationTrace {
  return {
    attemptId: 'attempt-1',
    startedAt: '2026-10-30T00:00:00.000Z',
    finishedAt: '2026-10-30T00:01:00.000Z',
    state,
    stages,
    ...overrides
  }
}

const allSucceeded: readonly GenerationStageId[] = [
  'source', 'candidates', 'selection', 'field-backfill', 'writing', 'validation', 'repair-1', 'repair-2', 'store'
]

function failureTrace(failed: GenerationStageId, failureCode: string, detail?: string): GenerationTrace {
  const index = allSucceeded.indexOf(failed)
  return trace('failed', allSucceeded.map((id, position) => position < index
    ? stage(id, 'success')
    : position === index
      ? stage(id, 'failed', { ...(failureCode ? { failureCode } : {}), ...(detail ? { failureDetail: detail } : {}) })
      : stage(id, 'skipped')))
}

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

function render(value: GenerationTrace | undefined, english = false): HTMLDivElement {
  act(() => {
    root!.render(<DailyBriefingGenerationTimeline
      trace={value}
      text={english ? englishText : text}
      formatTime={formatTime}
    />)
  })
  return container!
}

describe('generation stage timeline', () => {
  it('shows every stage, its timing and the whole-attempt duration on success', () => {
    const dom = render(trace('success', allSucceeded.map((id) => stage(id, 'success'))))
    // A successful attempt stays folded; the header still carries the status and the duration.
    expect(dom.querySelectorAll('[data-stage]')).toHaveLength(0)
    act(() => dom.querySelector<HTMLButtonElement>('.mi-generation-trace__toggle')!.click())
    const stages = [...dom.querySelectorAll('[data-stage]')]

    expect(stages).toHaveLength(9)
    expect(stages.map((entry) => entry.getAttribute('data-stage'))).toEqual(allSucceeded)
    expect(stages.every((entry) => entry.getAttribute('data-stage-state') === 'success')).toBe(true)
    expect(dom.textContent).toContain(text.generationTrace.title)
    expect(dom.textContent).toContain(text.generationTrace.completed)
    // Same-day attempts print only the clock; the date is noise inside one edition.
    expect(dom.textContent).toContain('本次尝试 · 00:00:00 → 00:01:00')
    expect(dom.textContent).toContain('耗时 1 分 0 秒')
    expect(dom.textContent).not.toContain('2026-10-30 00:00:00')
    expect(stages[0]?.textContent).toContain('00:00:05 → 00:00:06')
    expect(stages[0]?.textContent).toContain('1 秒')
    expect(dom.textContent).not.toContain(text.generationTrace.notRecorded)
  })

  it('adds the date only to the side that crosses midnight', () => {
    const dom = render(trace('success', [
      stage('source', 'success', { startedAt: '2026-10-30T23:59:50.000Z', finishedAt: '2026-10-31T00:00:10.000Z' }),
      stage('candidates', 'success')
    ], { startedAt: '2026-10-30T23:59:00.000Z', finishedAt: '2026-10-31T00:01:00.000Z' }))
    act(() => dom.querySelector<HTMLButtonElement>('.mi-generation-trace__toggle')!.click())

    expect(dom.textContent).toContain('10-30 23:59:00 → 10-31 00:01:00')
    expect(dom.querySelector('[data-stage="source"]')?.textContent).toContain('10-30 23:59:50 → 10-31 00:00:10')
    expect(dom.querySelector('[data-stage="candidates"]')?.textContent).toContain('00:00:05 → 00:00:06')
    expect(dom.querySelector('[data-stage="candidates"]')?.textContent).not.toContain('2026-10-30')
  })

  it('locates a source failure and marks later stages skipped', () => {
    const dom = render(failureTrace('source', 'source-failed'))
    const failed = dom.querySelector<HTMLElement>('[data-failed-stage-label]')!

    expect(dom.querySelector('[data-generation-trace-state]')?.getAttribute('data-generation-trace-state')).toBe('failed')
    expect(dom.querySelector('[data-failed-stage="source"]')).not.toBeNull()
    expect(failed.textContent).toBe('失败于：数据采集')
    expect(dom.querySelectorAll('[data-stage-state="skipped"]')).toHaveLength(8)
    expect(dom.querySelector('[data-stage="source"]')?.getAttribute('data-stage-state')).toBe('failed')
  })

  it('locates an AI-selection failure', () => {
    const dom = render(failureTrace('selection', 'unknown-fact'))
    expect(dom.querySelector('[data-failed-stage-label]')?.textContent).toBe('失败于：AI 选择')
    expect(dom.querySelector('[data-stage="selection"]')?.textContent).toContain(text.aiSettings.failure['unknown-fact'])
  })

  it('locates a truncated writing stage and redacts its detail', () => {
    const detail = 'stop_reason=max_tokens sk-live-SECRET0123456789\n    at handler (/app/private/secret.js:1:1)'
    const dom = render(failureTrace('writing', 'agent-turn-output-truncated', detail))
    const failed = dom.querySelector('[data-stage="writing"]')!

    expect(dom.querySelector('[data-failed-stage-label]')?.textContent).toBe('失败于：写作')
    expect(failed.textContent).toContain(text.aiSettings.failure['agent-turn-output-truncated'])
    expect(failed.textContent).toContain('stop_reason=max_tokens')
    expect(failed.textContent).not.toContain('sk-live-SECRET0123456789')
    expect(failed.textContent).not.toContain('/app/private/secret.js')
  })

  it('locates a validation failure', () => {
    const dom = render(failureTrace('validation', 'schema-validation-failed'))
    expect(dom.querySelector('[data-failed-stage-label]')?.textContent).toBe('失败于：校验')
    expect(dom.querySelector('[data-stage="validation"]')?.textContent)
      .toContain(text.aiSettings.failure['schema-validation-failed'])
  })

  it('locates a store/publish failure', () => {
    const dom = render(failureTrace('store', 'store-failed'))
    expect(dom.querySelector('[data-failed-stage-label]')?.textContent).toBe('失败于：落库/发布')
    expect(dom.querySelector('[data-stage="store"]')?.textContent).toContain(text.aiSettings.failure['store-failed'])
  })

  it('marks stages the trace does not carry as not recorded instead of guessing', () => {
    const dom = render(trace('success', [stage('source', 'success')]))
    act(() => dom.querySelector<HTMLButtonElement>('.mi-generation-trace__toggle')!.click())
    const selection = dom.querySelector('[data-stage="selection"]')!

    expect(selection.getAttribute('data-stage-state')).toBe('pending')
    expect(selection.textContent).toContain(text.generationTrace.notRecorded)
    expect(selection.textContent).not.toContain('00:00:05')
  })

  it('says the timeline was not recorded instead of guessing when the edition has no trace', () => {
    const dom = render(undefined)
    expect(dom.querySelector('[data-generation-trace-missing]')?.textContent).toBe(text.generationTrace.missing)
    expect(dom.querySelectorAll('[data-stage]')).toHaveLength(0)
    expect(dom.textContent).not.toContain(text.generationTrace.failed)
  })

  it('renders in English', () => {
    const dom = render(failureTrace('writing', 'agent-turn-output-truncated'), true)
    expect(dom.textContent).toContain(englishText.generationTrace.title)
    expect(dom.textContent).toContain(englishText.generationTrace.stages.writing)
    expect(dom.querySelector('[data-failed-stage-label]')?.textContent).toBe('Failed at: Writing')
  })
})

describe('generation trace parsing', () => {
  it('keeps a well-formed trace and its optional stage fields', () => {
    const parsed = readGenerationTrace({
      attemptId: 'a1', startedAt: '2026-10-30T00:00:00.000Z', finishedAt: '2026-10-30T00:01:00.000Z', state: 'success',
      stages: [{ id: 'source', state: 'success', durationMs: 500, failureCode: 'x' }]
    })
    expect(parsed?.stages[0]).toEqual({ id: 'source', state: 'success', durationMs: 500, failureCode: 'x' })
  })

  it('ignores a malformed trace, duplicate stages and unknown stages', () => {
    expect(readGenerationTrace({ attemptId: '', startedAt: 'x' })).toBeUndefined()
    const parsed = readGenerationTrace({
      attemptId: 'a1', startedAt: '2026-10-30T00:00:00.000Z', finishedAt: '2026-10-30T00:01:00.000Z', state: 'failed',
      stages: [
        { id: 'source', state: 'success' },
        { id: 'source', state: 'failed' },
        { id: 'unknown', state: 'success' },
        { id: 'writing', state: 'running' }
      ]
    })
    expect(parsed?.stages).toEqual([{ id: 'source', state: 'success' }])
  })
})
