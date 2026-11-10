// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SourceFilterBar, type SourceFilterChip } from './SourceFilterBar'

const COPY: Record<string, string> = {
  'settings.intelligenceSources.filter.chip': '{value} · 还剩 {remaining}',
  'settings.intelligenceSources.filter.clear': '清空筛选'
}
const resolveText = (key: string): string => COPY[key] ?? key

const CHIPS: readonly SourceFilterChip[] = [
  { dimension: 'panel', value: '看板', remaining: 3 },
  { dimension: 'importance', value: '高重要性', remaining: 3 }
]

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function render(props: Parameters<typeof SourceFilterBar>[0]): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root?.render(<SourceFilterBar {...props} />) })
  return host
}

describe('SourceFilterBar', () => {
  it('renders nothing at all when no condition is set, so no hidden control can take a Tab stop', async () => {
    // 判据 1：空态整块不渲染。`visibility:hidden` / `opacity:0` 会留一个 Tab 能进去的隐形按钮，
    // 这条断的是「DOM 里一个节点都没有」，不是断样式。
    const host = await render({ chips: [], empty: false, onClear: () => undefined, onDrop: () => undefined, resolveText })
    expect(host.querySelectorAll('[data-source-filter]')).toHaveLength(0)
    expect(host.querySelectorAll('button')).toHaveLength(0)
    // 键盘层面再确认一次：宿主容器里没有任何可聚焦元素。
    expect(host.querySelectorAll('[tabindex], button, a[href], input, select, textarea')).toHaveLength(0)
  })

  it('writes every chip as “value · remaining N”, never a bare number', async () => {
    const host = await render({ chips: CHIPS, empty: false, onClear: () => undefined, onDrop: () => undefined, resolveText })
    const chips = [...host.querySelectorAll<HTMLButtonElement>('.intelligence-source-filter__chip')]
    expect(chips).toHaveLength(2)
    expect(chips.map((chip) => chip.textContent)).toEqual(['看板 · 还剩 3', '高重要性 · 还剩 3'])
    // 裸数字的形态（只有 3）不许出现。
    for (const chip of chips) expect(chip.textContent?.trim()).not.toMatch(/^\d+$/u)
  })

  it('puts the state block above the conditions, and leaves clearing to the state action alone', async () => {
    // 第三笔：空态的三处位置收尾。状态块是**唯一**说明面且在上；条件胶囊在下；清空只活在状态动作里。
    const onClear = vi.fn()
    const host = await render({ chips: CHIPS, empty: true, onClear, onDrop: () => undefined, resolveText })
    expect(host.querySelectorAll('[data-source-filter="empty"]')).toHaveLength(1)

    const stateBlock = host.querySelector('[class*="state"]')?.closest('div') ?? null
    const chipsBlock = host.querySelector('.intelligence-source-filter__chips')
    expect(chipsBlock).not.toBeNull()
    // 状态块在条件之前：同一份结构里先读「筛出来是空的」，再读「松掉哪一格」。
    if (stateBlock !== null && chipsBlock !== null) {
      expect(stateBlock.compareDocumentPosition(chipsBlock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // 空态里清空只有一处入口（状态动作），不许再有第二颗常驻按钮。
    expect(host.querySelectorAll('[data-source-filter-clear="true"]')).toHaveLength(0)
    // 三颗按钮 = StateView 的动作「清空筛选」+ 两颗条件胶囊；没有第二颗常驻清空。
    const buttons = [...host.querySelectorAll('button')]
    expect(buttons).toHaveLength(CHIPS.length + 1)
  })

  it('never draws the layout switch on an empty result, but keeps the three things in one order when it does', async () => {
    // 空态里画「平铺 / 列表」只是多一个 Tab 停靠点：空结果没有「怎么排」这件事。
    const modeSwitch = <button data-mode-switch="true" type="button">平铺</button>
    const empty = await render({ chips: CHIPS, empty: true, modeSwitch, onClear: () => undefined, onDrop: () => undefined, resolveText })
    expect(empty.querySelectorAll('[data-mode-switch]')).toHaveLength(0)

    act(() => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    const active = await render({ chips: CHIPS, empty: false, modeSwitch, onClear: () => undefined, onDrop: () => undefined, resolveText })
    expect(active.querySelectorAll('[data-mode-switch]')).toHaveLength(1)
    // 三样同位置：清空在最前、模式切换第二、条件第三；条件与命中数逐字不变。
    const order = [...active.querySelectorAll<HTMLElement>('.intelligence-source-filter > *')]
      .map((node) => node.matches('[data-source-filter-clear]') ? 'clear'
        : node.matches('.intelligence-source-filter__mode') ? 'mode'
          : node.matches('.intelligence-source-filter__chips') ? 'chips' : 'other')
    expect(order).toEqual(['clear', 'mode', 'chips'])
    expect([...active.querySelectorAll('.intelligence-source-filter__chip')].map((chip) => chip.textContent))
      .toEqual(['看板 · 还剩 3', '高重要性 · 还剩 3'])
  })

  it('keeps one clear entry in the active state, and the empty state offers it only through StateView', async () => {
    const onClear = vi.fn()
    const active = await render({ chips: CHIPS, empty: false, onClear, onDrop: () => undefined, resolveText })
    const clear = active.querySelector<HTMLButtonElement>('[data-source-filter-clear="true"]')
    expect(clear).not.toBeNull()
    await act(async () => { clear?.click() })
    expect(onClear).toHaveBeenCalledTimes(1)

    act(() => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    const empty = await render({ chips: CHIPS, empty: true, onClear, onDrop: () => undefined, resolveText })
    // 空态：不再有第二颗常驻「清空筛选」，入口只剩 StateView 的动作。
    expect(empty.querySelectorAll('[data-source-filter-clear="true"]')).toHaveLength(0)
    // 条件胶囊仍在，且排在状态块下方——点一颗只松一格。
    const onDrop = vi.fn()
    const onClearInEmptyState = vi.fn()
    const withDrop = await render({ chips: CHIPS, empty: true, onClear: onClearInEmptyState, onDrop, resolveText })
    const chip = withDrop.querySelectorAll<HTMLButtonElement>('.intelligence-source-filter__chip')[0]!
    await act(async () => { chip.click() })
    expect(onDrop).toHaveBeenCalledWith(CHIPS[0])
    // 点一颗只松一格：空态里那颗胶囊不连带清空（清空只走 StateView 的动作）。
    expect(onClearInEmptyState).not.toHaveBeenCalled()
  })
})
