// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { ModelServiceModelTypeFilter, buildModelTypeCounts } from './ModelServiceModelTypeFilter'

/**
 * 模型类型筛选用平台 `Segmented`（界面 2026-11-09 判：这是**筛选**不是分页，不给 `Tabs`）。
 *
 * 判据钉在**可访问结构**上，不钉类名：容器是 `role="group"` 且带可访问名，每项是
 * `aria-pressed` 的按钮；旧的自绘药丸（`data-model-type-tab` 的原生 button 列表）不该再出现。
 * 键盘：左右只移动焦点、Enter/Space 才选中——这是 `Segmented` 的语义，不该退化成「移动即生效」。
 */
const labels = platformText['zh-CN'].models
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function mount(active: Parameters<typeof ModelServiceModelTypeFilter>[0]['active'] = 'all') {
  const onChange = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      createElement(ModelServiceModelTypeFilter, {
        labels,
        active,
        counts: buildModelTypeCounts([]),
        onChange
      })
    )
  )
  return { container, onChange }
}

describe('模型类型筛选', () => {
  it('is a single-select group of pressed buttons, not a hand-drawn tab strip', () => {
    const { container } = mount('text')

    const group = container.querySelector('[role="group"]')
    expect(group).not.toBeNull()
    expect(group?.getAttribute('aria-label')).toBe(labels.typeFilterLabel)

    const items = [...(group?.querySelectorAll('button') ?? [])]
    expect(items.length).toBeGreaterThan(1)
    // 单选语义：每个按钮都带 aria-pressed，只有选中项为 true。
    expect(items.every((item) => item.hasAttribute('aria-pressed'))).toBe(true)
    expect(items.filter((item) => item.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    // 旧自绘药丸的钩子不该再存在于原生按钮上。
    expect(container.querySelector('button[data-model-type-tab]')).toBeNull()
    // 页签语义不该出现在筛选里。
    expect(container.querySelector('[role="tablist"]')).toBeNull()
  })

  it('resolves every label through its real platformText path', () => {
    const { container } = mount('all')
    const texts = [...container.querySelectorAll<HTMLButtonElement>('[role="group"] button')].map(
      (button) => button.textContent ?? ''
    )

    // 11 个标签都必须是「文案 + 计数」。键写成短名（`typeVision`）或路径打错时，
    // 解析器取不到文案，这里会退化成只显示计数（前导空格）——所以这条能对着可见文案跑红。
    const fields = [
      'typeAll',
      'typeDeal',
      'typeText',
      'typeRerank',
      'typeEmbedding',
      'typeImage',
      'typeVideo',
      'typeSpeech',
      'typeTranscription',
      'typeOcr',
      'typeVision'
    ] as const
    expect(texts).toEqual(fields.map((field) => `${labels[field]} 0`))
  })

  it('keeps arrow keys moving focus only, and Enter selects', () => {
    const { container, onChange } = mount('all')
    const items = [...container.querySelectorAll<HTMLButtonElement>('[role="group"] button')]
    const first = items[0]!

    act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    // 左右只移动焦点：不选中、不回调。
    expect(onChange).not.toHaveBeenCalled()

    act(() => items[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('selects on click through the same value the caller asked for', () => {
    const { container, onChange } = mount('all')
    const target = container.querySelectorAll<HTMLButtonElement>('[role="group"] button')[2]!

    act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onChange).toHaveBeenCalledWith('text')
  })
})
