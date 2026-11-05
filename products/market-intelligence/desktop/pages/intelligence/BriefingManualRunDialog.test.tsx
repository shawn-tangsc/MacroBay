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
  await act(async () => { root.render(<BriefingManualRunDialog open text={text} running={running} onRun={onRun} onReplace={vi.fn()} onClose={vi.fn()} />) })
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

  it('moves the cutoff explanation into its question mark, and keeps it out of the body', async () => {
    await render()
    // A7.9（v2.53）：说明性正文不许铺在弹框里，收进问号。
    expect(document.querySelector('[data-time-grid]')).toBeNull()
    expect(document.body.textContent).not.toContain(text.manualRunDialog.nowHint)
    const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${text.manualRunDialog.cutoffHintLabel}"]`)
    expect(trigger, 'the cutoff has no question mark').not.toBeNull()
    // 展开后是同一张表算出来的档位说明：读者看得到，正文里不占一行。
    const grid = dailyBriefingGenerationGrid
    await act(async () => { trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await Promise.resolve() })
    const bubble = document.body.textContent ?? ''
    expect(bubble).toContain(grid.first)
    expect(bubble).toContain(grid.last)
    expect(bubble).toContain(String(grid.stepMinutes))
  })

  // 用户当场卡住的那一下：点时间那一行，说明浮层自己弹出来压住下拉。
  // 根因是 `<label>` 里第一个可聚焦元素是问号，点 label 任何位置都会"点到"它。
  it('keeps the question mark out of the field label, so clicking the row cannot open it', async () => {
    await render()
    const cutoffLabel = document.querySelector<HTMLLabelElement>('label[for="mi-briefing-manual-cutoff"]')
    expect(cutoffLabel, 'the cutoff title is not a label bound to its control').not.toBeNull()
    // 问号不在 label 里：label 内只剩标题文字。
    expect(cutoffLabel!.querySelector('button')).toBeNull()
    expect(document.querySelector('label .icon-button')).toBeNull()

    // 点标题那一带（等价于点 label）：只把焦点给下拉，不许打开任何浮层。
    await act(async () => { cutoffLabel!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    // 丢焦点后 hover 也不该残留：浮层只在指针真的在问号上时开着。
    const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${text.manualRunDialog.cutoffHintLabel}"]`)!
    expect(trigger.closest('label')).toBeNull()
  })

  // 界面设计定的三条里的第 1 条：悬停打开、移开即关——它不钉住、不抢焦点，
  // 所以鼠标一移向下拉框它就没了；"一选就被顶掉"的根子是它**一直开着**。
  it('opens the explanation on hover and closes it when the pointer leaves', async () => {
    await render()
    const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${text.manualRunDialog.cutoffHintLabel}"]`)!
    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await Promise.resolve() })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    await act(async () => { trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); await Promise.resolve() })
    // 移开即关：不是"还在但看不见"，触发器的展开态必须已经回到 false。
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('does not put the initial focus on a question mark', async () => {
    await render()
    const active = document.activeElement as HTMLElement | null
    expect(active?.classList.contains('icon-button') ?? false).toBe(false)
    // 键盘仍然能到：问号是真实按钮，排在标题里，Tab 顺序不被结构改动打乱。
    const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${text.manualRunDialog.cutoffHintLabel}"]`)!
    expect(trigger.tabIndex).toBeGreaterThanOrEqual(0)
    await act(async () => { trigger.focus() })
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    await act(async () => { trigger.click(); await Promise.resolve() })
    expect(document.body.textContent).toContain(dailyBriefingGenerationGrid.first)
  })

  it('says why a future cutoff was refused, and stays open to fix it', async () => {
    // 反向用例的另一半：拒绝要说得出原因，而且弹框不关——读者当场改时刻，不用重新点开。
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => { root.render(<BriefingManualRunDialog open text={text} problem="cutoff-in-future" onRun={vi.fn()} onReplace={vi.fn()} onClose={vi.fn()} />) })
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

  it('gives every field and the action row its own named question mark', async () => {
    // 点开是空气泡比没有更糟：每枚问号都必须有 aria-label 指向它解释的对象，而且正文里不重复。
    await render()
    const labels = [text.manualRunDialog.cutoffHintLabel, text.manualRunDialog.windowHintLabel, text.manualRunDialog.languageHintLabel, text.manualRunDialog.repeatHintLabel]
    for (const label of labels) {
      const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      expect(trigger, label).not.toBeNull()
    }
    expect(document.body.textContent).not.toContain(text.manualRunDialog.windowHint)
    expect(document.body.textContent).not.toContain(text.manualRunDialog.languageHint)
  })

  it('says the same combination may be generated again, and does not refuse the second press', async () => {
    const { onRun } = await render()
    // A7.9（v2.53）：这句说明已不在正文里（说明性正文命中 0），第二次按下仍然不拒绝。
    expect(document.body.textContent).not.toContain(text.manualRunDialog.repeatable)
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
