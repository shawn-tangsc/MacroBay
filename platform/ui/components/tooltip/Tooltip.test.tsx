// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { TOOLTIP_MAX_CJK, TOOLTIP_MAX_LATIN, Tooltip } from './Tooltip'

const source = readFileSync(join(__dirname, 'Tooltip.tsx'), 'utf8')

const key = (value: string): string => value

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(resolveText: (value: string) => string = key): Promise<HTMLButtonElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <Tooltip labelKey="ui.test.hint" resolveText={resolveText}>
        <button type="button" data-trigger>
          trigger
        </button>
      </Tooltip>
    )
  })
  const trigger = host.querySelector<HTMLButtonElement>('[data-trigger]')
  if (!trigger) throw new Error('no trigger rendered')
  return trigger
}

/** antd 的弹层挂在传送门里、一帧后才进 DOM；轮询到出现为止，不用固定 sleep。 */
async function tooltipText(trigger: HTMLButtonElement): Promise<string | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const describedBy = trigger.getAttribute('aria-describedby')
    if (describedBy !== null) {
      const target = document.getElementById(describedBy)
      if (target !== null) return target.textContent
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  return null
}

describe('Tooltip', () => {
  it('shows on focus, because a title tooltip never does', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })

    expect(await tooltipText(trigger)).toBe('ui.test.hint')
  })

  it('does not fall back to the key name when the resolver misses', async () => {
    // 缺键 → 空串：整条提示不渲染，也不把 `ui.test.hint` 念给读者。
    const trigger = await mount(() => '')
    await act(async () => {
      trigger.focus()
    })

    expect(await tooltipText(trigger)).toBeNull()
    expect(document.body.textContent).not.toContain('ui.test.hint')
  })

  it('closes on Escape and keeps the focus where it was', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })
    expect(await tooltipText(trigger)).toBe('ui.test.hint')

    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    // 焦点不回跳是这条的契约；弹层本身要处于「非打开」态（antd 关闭后加 hidden 类）。
    expect(document.activeElement).toBe(trigger)
    // 弹层节点会留着做动画，但关闭后会被挪到屏幕外（antd 用 `-1000vw/-1000vh` 表示不可见）；
    // 真正的可见性由界面设计的真机 Esc 验收兜底，这里只钉「不再显示」与「焦点不回跳」。
    const popup = document.querySelector('.ant-tooltip')
    const hidden =
      popup === null ||
      popup.className.includes('hidden') ||
      popup.getAttribute('aria-hidden') === 'true' ||
      (popup.getAttribute('style') ?? '').includes('-1000')
    expect(hidden).toBe(true)
  })

  it('renders the trigger untouched and adds no wrapper of its own', async () => {
    const trigger = await mount()
    expect(trigger.hasAttribute('data-trigger')).toBe(true)
    // 我们自己不包容器：包一层会改掉父级布局，也是「无法聚焦的包裹元素」那种变体的入口。
    expect(document.querySelector('.ant-tooltip-open')).toBeNull()
  })

  it('takes no placement: the position is fixed behaviour, not a call-site option', () => {
    const props = source.slice(source.indexOf('export type TooltipProps'), source.indexOf('const PLACEMENT'))
    expect(props).not.toMatch(/placement\s*\??:/)
    // 位置只出现在组件自己那一行；调用点传 `placement` 一律不生效，因为 props 里根本没有这个字段。
    expect(source).toContain("const PLACEMENT = 'bottom' as const")
    expect(source.match(/placement=/g)).toHaveLength(1)
  })

  it('keeps the copy ceiling visible in the exported constants', () => {
    expect(TOOLTIP_MAX_CJK).toBe(28)
    expect(TOOLTIP_MAX_LATIN).toBe(60)
  })
})
