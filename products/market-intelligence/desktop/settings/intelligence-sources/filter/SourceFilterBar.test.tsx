// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SourceFilterBar, type SourceFilterBarProps } from './SourceFilterBar'

const text: SourceFilterBarProps['text'] = {
  clearFilter: '清空筛选',
  optionRemaining: '{option} · 还剩 {count}',
  rowCount: '{count} 条',
  valuesAriaLabel: '{dimension} 的取值',
  allValues: '全部',
  pickedMany: '{count} 个',
  valueJoiner: ' / ',
  summaryAll: '{total} 个来源',
  summaryFiltered: '已选 {picked} 个条件 · {matched} / {total}'
}

const dimensions = [
  {
    key: 'panel',
    label: '面板',
    options: [
      { value: 'dashboard', label: '看板' },
      { value: 'calendar', label: '经济日历' }
    ]
  },
  {
    key: 'category',
    label: '类别',
    options: [
      { value: 'macro', label: '宏观' },
      { value: 'crypto', label: '加密' }
    ]
  }
] as const

/** 命中数由宿主算：这里按「值 → 加上它之后还剩几条」给固定答案，好断言文案。 */
const remainingByValue: Record<string, number> = { dashboard: 9, calendar: 5, macro: 12, crypto: 2 }

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function render(overrides: Partial<SourceFilterBarProps> = {}): HTMLDivElement {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <SourceFilterBar
        dimensions={dimensions as never}
        onClear={vi.fn()}
        onToggleValue={vi.fn()}
        remainingCount={(_key, value) => remainingByValue[value] ?? 0}
        resultCount={9}
        rowMatchCount={() => 9}
        selection={{}}
        text={text}
        totalSourceCount={14}
        {...overrides}
      />
    )
  })
  return host
}

/** 与浏览器 Tab 序同义的可聚焦元素集合：DOM 顺序、排除 `tabindex="-1"` 与禁用项。 */
function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !(element as HTMLButtonElement).disabled)
}

describe('SourceFilterBar', () => {
  it('gives the remaining count its own word instead of a bare number', () => {
    const container = render()
    const chips = Array.from(container.querySelectorAll('.source-filter-bar__value')).map((chip) => chip.textContent)
    // 值 + 词 + 数字：读者不会把 9 猜成「这个值一共 9 条」。
    expect(chips).toContain('看板 · 还剩 9')
    expect(chips).toContain('宏观 · 还剩 12')
    for (const label of chips) expect(label).toMatch(/· 还剩 \d+$/)
  })

  it('keeps a zero-hit value visible and clickable instead of hiding it', () => {
    const onToggleValue = vi.fn()
    const container = render({
      remainingCount: () => 0,
      onToggleValue,
      selection: { panel: ['dashboard'], category: ['macro'] }
    })
    const empty = container.querySelector<HTMLButtonElement>('.source-filter-bar__value[data-empty="true"]')
    expect(empty).not.toBeNull()
    expect(empty!.textContent).toBe('经济日历 · 还剩 0')
    expect(empty!.disabled).toBe(false)
    act(() => empty!.click())
    expect(onToggleValue).toHaveBeenCalledWith('panel', 'calendar')
  })

  it('does not render the clear button while the list is empty, and it is not in the tab order', () => {
    const container = render({ resultCount: 0, selection: { panel: ['dashboard'], category: ['crypto'] } })
    // ① DOM 里命中 0：不是「存在但看不见」。
    expect(container.querySelector('.source-filter-bar__clear')).toBeNull()
    expect(container.textContent).not.toContain(text.clearFilter)
    // ② Tab 序里也不出现：焦点从最后一个条件行直接到别处，不停在一个空槽上。
    expect(focusables(container).map((element) => element.textContent ?? '')).not.toContain(text.clearFilter)
  })

  it('renders the single clear button on the left as soon as there are results', () => {
    const onClear = vi.fn()
    const container = render({ onClear, selection: { panel: ['dashboard'] } })
    const clear = Array.from(container.querySelectorAll<HTMLButtonElement>('.source-filter-bar__clear'))
    expect(clear).toHaveLength(1)
    expect(clear[0]!.textContent).toBe(text.clearFilter)
    expect(focusables(container).map((element) => element.textContent ?? '')).toContain(text.clearFilter)
    act(() => clear[0]!.click())
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('disables the clear button only while nothing is picked (still exactly one)', () => {
    const container = render({ resultCount: 14, selection: {} })
    const clear = container.querySelector<HTMLButtonElement>('.source-filter-bar__clear')
    expect(clear?.disabled).toBe(true)
    expect(container.textContent).toContain('14 个来源')
  })

  it('shows how many conditions are picked and how many rows are left', () => {
    const container = render({ resultCount: 2, selection: { panel: ['dashboard'], category: ['crypto'] } })
    expect(container.textContent).toContain('已选 2 个条件 · 2 / 14')
    const picked = Array.from(container.querySelectorAll('.source-filter-bar__dimension-picked')).map(
      (node) => node.textContent
    )
    expect(picked).toEqual(['看板', '加密'])
  })
})
