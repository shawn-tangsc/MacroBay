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
    ...(state === 'success' || state === 'failed' ? {
      startedAt: '2026-10-30T00:00:05.000Z',
      finishedAt: '2026-10-30T00:00:06.000Z',
      durationMs: 1_000
    } : {}),
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
  // AntD keeps closed popups in its own portal; drop them so a later test cannot read a stale one.
  for (const tip of document.querySelectorAll('.ant-tooltip, .ant-popover')) tip.remove()
})

function render(value: GenerationTrace | undefined, english = false, copy: typeof text = english ? englishText : text): HTMLDivElement {
  act(() => {
    root!.render(<DailyBriefingGenerationTimeline
      trace={value}
      text={copy}
      formatTime={formatTime}
    />)
  })
  return container!
}

function stepItems(dom: HTMLElement): HTMLElement[] {
  return [...dom.querySelectorAll<HTMLElement>('.ant-steps-item')]
}

function stepOf(dom: HTMLElement, id: GenerationStageId): HTMLElement {
  const title = dom.querySelector<HTMLElement>(`[data-stage="${id}"]`)
  const item = title?.closest<HTMLElement>('.ant-steps-item')
  if (!item) throw new Error(`no step for ${id}`)
  return item
}

function resultOf(dom: HTMLElement, id: GenerationStageId): HTMLElement {
  const result = dom.querySelector<HTMLElement>(`[data-stage-result="${id}"]`)
  if (!result) throw new Error(`no step description for ${id}`)
  return result
}

/** AntD keeps a closed popup mounted but hides its root; only visible tooltips count as shown. */
function visibleTooltipText(): string {
  // The stage explanation is a popover: a paragraph, not a one-line hint. The popup stays in the DOM
  // with a hidden class when closed, so visibility is decided by that class, not by presence.
  return [...document.querySelectorAll('.ant-popover')]
    .filter((element) => !element.classList.contains('ant-popover-hidden')
      // happy-dom does not end the zoom-out motion either, so a leaving popup still sits in the DOM.
      && !/ant-zoom-.*-(leave|leave-active)/.test(element.className))
    .map((element) => element.querySelector('.platform-popover__content')?.textContent ?? '')
    .join(' ')
}

function visibleTooltipTextLegacy(): string {
  return [...document.querySelectorAll('.ant-tooltip')]
    .filter((element) => !element.classList.contains('ant-tooltip-hidden')
      // happy-dom does not end the zoom-out motion, so a leaving popup is still in the DOM.
      && !element.classList.contains('ant-zoom-big-fast-leave')
      && !element.classList.contains('ant-zoom-big-fast-leave-active'))
    .map((element) => element.textContent ?? '')
    .join(' ')
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)) })
}

describe('generation stage timeline', () => {
  it('opens a finished run by default, and the summary line still carries the step count and duration', () => {
    const dom = render(trace('success', allSucceeded.map((id) => stage(id, 'success'))))
    const steps = stepItems(dom)
    const details = dom.querySelector<HTMLDetailsElement>('.mi-generation-trace')!
    // Contract: the list is open in every state — the reader asked to see the steps without a
    // click — and the summary line is where collapsing starts.
    expect(details.tagName).toBe('DETAILS')
    expect(details.open).toBe(true)
    expect(details.querySelector('summary')!.textContent).toMatch(/生成阶段9 步 · .+ · 全部完成/)
    expect(dom.querySelector('.ant-steps-vertical')).not.toBeNull()
    expect(steps).toHaveLength(9)
    expect(steps.map((entry) => entry.querySelector('[data-stage]')?.getAttribute('data-stage'))).toEqual(allSucceeded)
    expect(steps.every((entry) => entry.classList.contains('ant-steps-item-finish'))).toBe(true)
    expect(dom.textContent).toContain(text.generationTrace.title)
    expect(dom.textContent).toContain(text.generationTrace.allCompleted)
    // Same-day attempts print only the clock; the date is noise inside one edition.
    expect(dom.textContent).toContain('本次尝试 · 00:00:00 → 00:01:00')
    expect(dom.textContent).toContain('耗时 1 分 0 秒')
    expect(dom.textContent).not.toContain('2026-10-30 00:00:00')
    expect(resultOf(dom, 'source').textContent).toContain('00:00:05 → 00:00:06')
    expect(resultOf(dom, 'source').textContent).toContain('1 秒')
    expect(dom.textContent).not.toContain(text.generationTrace.notRecorded)
    // The count in the summary is the number of rows the detail renders, not a literal.
    expect(steps).toHaveLength(9)
  })

  it('prints one instant when a run starts and ends in the same second', () => {
    const instant = '2026-10-30T00:00:05.000Z'
    const dom = render(trace('success', [
      stage('source', 'success', { startedAt: instant, finishedAt: instant, durationMs: 0 })
    ], { startedAt: instant, finishedAt: instant }))

    // One fact, one time: the arrow with the same value on both sides reads like a defect.
    const summary = dom.querySelector('.mi-generation-trace__summary')?.textContent ?? ''
    expect(summary).toContain('00:00:05')
    expect(summary).not.toContain('→')
    expect(resultOf(dom, 'source').textContent).toContain('00:00:05')
    expect(resultOf(dom, 'source').textContent).not.toContain('00:00:05 → 00:00:05')
  })

  it('maps finish, error and wait to the recorded stage states', () => {
    const success = render(trace('success', allSucceeded.map((id) => stage(id, 'success'))))
    expect(stepItems(success).every((item) => item.classList.contains('ant-steps-item-finish'))).toBe(true)

    const failed = render(failureTrace('validation', 'schema-validation-failed'))
    expect(stepOf(failed, 'source').classList.contains('ant-steps-item-finish')).toBe(true)
    expect(stepOf(failed, 'validation').classList.contains('ant-steps-item-error')).toBe(true)
    expect(stepOf(failed, 'store').classList.contains('ant-steps-item-wait')).toBe(true)
  })

  it('waits on a stage the trace does not carry, including an unrecorded second repair', () => {
    const dom = render(trace('success', [stage('source', 'success')]))
    // repair-2 is absent from this trace: it waits, it never claims a process or a finish.
    expect(stepOf(dom, 'repair-2').classList.contains('ant-steps-item-wait')).toBe(true)
    expect(stepOf(dom, 'repair-2').querySelector('[data-stage]')?.getAttribute('data-stage-state')).toBe('pending')
    expect(stepOf(dom, 'selection').classList.contains('ant-steps-item-wait')).toBe(true)
    expect(resultOf(dom, 'selection').textContent).toContain(text.generationTrace.notRecorded)
    expect(resultOf(dom, 'selection').textContent).not.toContain('00:00:05')
  })

  it('counts a skipped repair on a clean run as a finished step, not a grey skip', () => {
    const dom = render(trace('success', [
      ...['source', 'candidates', 'selection', 'field-backfill', 'writing', 'validation'].map((id) => stage(id as GenerationStageId, 'success')),
      stage('repair-1', 'skipped'),
      stage('repair-2', 'skipped'),
      stage('store', 'success')
    ]))
    expect(stepOf(dom, 'repair-2').classList.contains('ant-steps-item-finish')).toBe(true)
    expect(resultOf(dom, 'repair-2').textContent).toContain(text.generationTrace.states.notNeeded)
    expect(resultOf(dom, 'repair-2').textContent).not.toContain(text.generationTrace.states.skipped)
  })

  it('keeps a stage skipped because an earlier one failed grey and not run', () => {
    const dom = render(failureTrace('source', 'source-failed'))
    expect(stepOf(dom, 'repair-2').classList.contains('ant-steps-item-wait')).toBe(true)
    expect(dom.querySelector('[data-stage="repair-2"]')?.getAttribute('data-stage-skip')).toBe('blocked')
    expect(resultOf(dom, 'repair-2').textContent).toContain(text.generationTrace.states.notRun)
  })

  it('shows a stage that began but never finished as process', () => {
    const dom = render(trace('success', [
      stage('source', 'success'),
      stage('candidates', 'pending', { startedAt: '2026-10-30T00:00:05.000Z' })
    ]))
    expect(stepOf(dom, 'candidates').classList.contains('ant-steps-item-process')).toBe(true)
    expect(resultOf(dom, 'candidates').textContent).toContain('00:00:05')
  })

  it('adds the date only to the side that crosses midnight', () => {
    const dom = render(trace('success', [
      stage('source', 'success', { startedAt: '2026-10-30T23:59:50.000Z', finishedAt: '2026-10-31T00:00:10.000Z' }),
      stage('candidates', 'success')
    ], { startedAt: '2026-10-30T23:59:00.000Z', finishedAt: '2026-10-31T00:01:00.000Z' }))

    expect(dom.textContent).toContain('10-30 23:59:00 → 10-31 00:01:00')
    expect(resultOf(dom, 'source').textContent).toContain('10-30 23:59:50 → 10-31 00:00:10')
    expect(resultOf(dom, 'candidates').textContent).toContain('00:00:05 → 00:00:06')
    expect(resultOf(dom, 'candidates').textContent).not.toContain('2026-10-30')
  })

  it('locates a source failure and keeps the later steps waiting', () => {
    const dom = render(failureTrace('source', 'source-failed'))
    const failed = dom.querySelector<HTMLElement>('[data-failed-stage-label]')!

    expect(dom.querySelector('[data-generation-trace-state]')?.getAttribute('data-generation-trace-state')).toBe('failed')
    expect(dom.querySelector('[data-failed-stage="source"]')).not.toBeNull()
    expect(failed.textContent).toBe('失败于：数据采集')
    expect(stepOf(dom, 'source').classList.contains('ant-steps-item-error')).toBe(true)
    expect(dom.querySelectorAll('.ant-steps-item-wait')).toHaveLength(8)
  })

  it('locates an AI-selection failure', () => {
    const dom = render(failureTrace('selection', 'unknown-fact'))
    expect(dom.querySelector('[data-failed-stage-label]')?.textContent).toBe('失败于：AI 选择')
    expect(resultOf(dom, 'selection').textContent).toContain(text.aiSettings.failure['unknown-fact'])
  })

  it('locates a truncated writing stage and redacts its detail', () => {
    const detail = 'stop_reason=max_tokens sk-live-SECRET0123456789\n    at handler (/app/private/secret.js:1:1)'
    const dom = render(failureTrace('writing', 'agent-turn-output-truncated', detail))
    const failed = resultOf(dom, 'writing')

    expect(dom.querySelector('[data-failed-stage-label]')?.textContent).toBe('失败于：写作')
    expect(failed.textContent).toContain(text.aiSettings.failure['agent-turn-output-truncated'])
    expect(failed.textContent).toContain('stop_reason=max_tokens')
    expect(failed.textContent).not.toContain('sk-live-SECRET0123456789')
    expect(failed.textContent).not.toContain('/app/private/secret.js')
  })

  it('locates a validation failure', () => {
    const dom = render(failureTrace('validation', 'schema-validation-failed'))
    expect(dom.querySelector('[data-failed-stage-label]')?.textContent).toBe('失败于：校验')
    expect(resultOf(dom, 'validation').textContent)
      .toContain(text.aiSettings.failure['schema-validation-failed'])
  })

  it('locates a store/publish failure', () => {
    const dom = render(failureTrace('store', 'store-failed'))
    expect(dom.querySelector('[data-failed-stage-label]')?.textContent).toBe('失败于：落库/发布')
    expect(resultOf(dom, 'store').textContent).toContain(text.aiSettings.failure['store-failed'])
  })

  it('puts each stage’s fixed logic behind a question mark instead of inline', () => {
    const dom = render(trace('success', allSucceeded.map((id) => stage(id, 'success'))))
    for (const id of allSucceeded) {
      const help = stepOf(dom, id).querySelector<HTMLButtonElement>(`[data-stage-help="${id}"]`)
      expect(help, id).not.toBeNull()
      expect(help?.getAttribute('aria-label')).toBe(text.generationTrace.stageHelpLabel.replace('{stage}', text.generationTrace.stages[id]))
      expect(stepOf(dom, id).textContent).not.toContain(text.generationTrace.stageHelp[id])
      expect(text.generationTrace.stageHelp[id].length).toBeGreaterThan(0)
      expect(englishText.generationTrace.stageHelp[id].length).toBeGreaterThan(0)
    }
  })

  it('shows the logic on hover and on keyboard focus', async () => {
    const dom = render(trace('success', allSucceeded.map((id) => stage(id, 'success'))))
    const help = dom.querySelector<HTMLButtonElement>('[data-stage-help="source"]')!

    expect(visibleTooltipText()).not.toContain(text.generationTrace.stageHelp.source)
    act(() => help.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await settle()
    expect(visibleTooltipText()).toContain(text.generationTrace.stageHelp.source)

    // Leaving closes it again; the content is a popover, never a permanent row.
    act(() => help.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    await settle()
    expect(visibleTooltipText()).not.toContain(text.generationTrace.stageHelp.source)

    await act(async () => { help.focus() })
    await settle()
    expect(visibleTooltipText()).toContain(text.generationTrace.stageHelp.source)
  })

  it('pins on click and closes on a second click', async () => {
    const dom = render(trace('success', allSucceeded.map((id) => stage(id, 'success'))))
    const help = dom.querySelector<HTMLButtonElement>('[data-stage-help="writing"]')!

    act(() => help.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await settle()
    act(() => help.click())
    // Pinned: leaving the icon keeps it open.
    act(() => help.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    await settle()
    expect(visibleTooltipText()).toContain(text.generationTrace.stageHelp.writing)

    // A pinned icon also closes on a second click.
    act(() => help.click())
    await settle()
    expect(visibleTooltipText()).not.toContain(text.generationTrace.stageHelp.writing)
  })

  it('closes on Escape and leaves the focus on the trigger', async () => {
    const dom = render(trace('success', allSucceeded.map((id) => stage(id, 'success'))))
    const help = dom.querySelector<HTMLButtonElement>('[data-stage-help="writing"]')!

    await act(async () => { help.focus() })
    await settle()
    expect(visibleTooltipText()).toContain(text.generationTrace.stageHelp.writing)

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await settle()
    expect(visibleTooltipText()).not.toContain(text.generationTrace.stageHelp.writing)
    expect(document.activeElement).toBe(help)
  })

  it('renders no question mark when a stage has no help line', () => {
    const withoutHelp = {
      ...text,
      generationTrace: {
        ...text.generationTrace,
        stageHelp: { ...text.generationTrace.stageHelp, writing: '' }
      }
    } as unknown as typeof text
    const dom = render(trace('success', allSucceeded.map((id) => stage(id, 'success'))), false, withoutHelp)

    expect(dom.querySelector('[data-stage-help="writing"]')).toBeNull()
    expect(dom.querySelector('[data-stage-help="source"]')).not.toBeNull()
    // The stage itself, its timing and the rest of the stepper are untouched by the missing line.
    expect(resultOf(dom, 'writing').textContent).toContain('00:00:05 → 00:00:06')
  })

  it('says the timeline was not recorded instead of guessing when the edition has no trace', () => {
    const dom = render(undefined)
    expect(dom.querySelector('[data-generation-trace-missing]')?.textContent).toBe(text.generationTrace.missing)
    expect(dom.querySelectorAll('.ant-steps-item')).toHaveLength(0)
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
