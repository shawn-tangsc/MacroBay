// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { dailyBriefingGenerationGrid } from '../../../contracts/dailyBriefing'
import { BriefingManualRunDialog } from './BriefingManualRunDialog'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

let host: HTMLDivElement
let root: Root

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

const render = async (running = false) => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onRun = vi.fn()
  await act(async () => { root.render(<BriefingManualRunDialog open text={text} running={running} onRun={onRun} onClose={vi.fn()} />) })
  await act(async () => { await Promise.resolve() })
  return { onRun }
}

const openOptions = async (label: string): Promise<HTMLElement[]> => {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  const selector = input.closest('.ant-select')!.querySelector<HTMLElement>('.ant-select-selector')!
  await act(async () => { selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await Promise.resolve() })
  return [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')]
}

const pick = async (label: string, option: string): Promise<void> => {
  const items = await openOptions(label)
  const item = items.find((node) => node.textContent?.trim() === option)!
  expect(item, `option ${option} for ${label}`).not.toBeUndefined()
  await act(async () => { item.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

const runButton = (): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => {
      const label = button.textContent?.replace(/\s/g, '') ?? ''
      return label === text.manualRunDialog.run || label === text.manualRunDialog.running
    })!

describe('briefing manual run dialog', () => {
  it('offers "now" as a peer cutoff option, not a hidden control', async () => {
    await render()
    const options = await openOptions(text.manualRunDialog.cutoff)
    expect(options.map((node) => node.textContent?.trim())).toContain(text.manualRunDialog.now)
  })

  it('names the same half-hour grid the cutoff list offers, from the policy table', async () => {
    await render()
    const hint = document.querySelector<HTMLElement>('[data-time-grid]')
    expect(hint, 'the form never names its grid').not.toBeNull()
    const grid = dailyBriefingGenerationGrid
    expect(hint!.textContent).toContain(grid.first)
    expect(hint!.textContent).toContain(grid.last)
    expect(hint!.textContent).toContain(String(grid.count))
    expect(hint!.textContent).toContain(String(grid.stepMinutes))
    // "Now" is a third choice and is not one of the slots — it stays out of the grid sentence.
    expect(hint!.textContent).not.toContain(text.manualRunDialog.now)
  })

  it('says why a future cutoff was refused, and stays open to fix it', async () => {
    // 反向用例的另一半：拒绝要说得出原因，而且弹框不关——读者当场改时刻，不用重新点开。
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => { root.render(<BriefingManualRunDialog open text={text} problem="cutoff-in-future" onRun={vi.fn()} onClose={vi.fn()} />) })
    await act(async () => { await Promise.resolve() })
    const problem = document.querySelector('[data-manual-problem="cutoff-in-future"]')
    expect(problem?.textContent).toBe(text.manualRunDialog.cutoffInFuture)
  })

  it('runs with the chosen cutoff, window and language', async () => {
    const { onRun } = await render()
    // An evening-free slot that the old morning-only table could not offer.
    await pick(text.manualRunDialog.cutoff, '12:00')
    await pick(text.manualRunDialog.windowHours, text.manualRunDialog.windowValue.replace('{hours}', '12'))
    await pick(text.manualRunDialog.language, text.history.languages['en-US'])
    await act(async () => { runButton().click() })

    expect(onRun).toHaveBeenCalledWith({ cutoff: '12:00', windowHours: 12, language: 'en-US' })
  })

  it('offers an evening cutoff as a real option', async () => {
    const { onRun } = await render()
    await pick(text.manualRunDialog.cutoff, '21:30')
    await act(async () => { runButton().click() })
    expect(onRun).toHaveBeenCalledWith({ cutoff: '21:30', windowHours: 24, language: 'zh-CN' })
  })

  it('says the same combination may be generated again, and does not refuse the second press', async () => {
    const { onRun } = await render()
    // A7.9: without this sentence the second press looks like a mistake.
    expect(document.body.textContent).toContain(text.manualRunDialog.repeatable)
    await act(async () => { runButton().click() })
    await act(async () => { runButton().click() })
    // A7.4: no uniqueness rule here — the reader asked twice, so two runs are requested.
    expect(onRun).toHaveBeenCalledTimes(2)
    expect(onRun).toHaveBeenNthCalledWith(2, { cutoff: 'now', windowHours: 24, language: 'zh-CN' })
  })

  it('does not let a second press start while one run is in flight', async () => {
    const { onRun } = await render(true)
    expect(runButton().disabled).toBe(true)
    await act(async () => { runButton().click() })
    expect(onRun).not.toHaveBeenCalled()
  })
})
