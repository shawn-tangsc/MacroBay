// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Tooltip } from './Tooltip'

const source = readFileSync(join(__dirname, 'Tooltip.tsx'), 'utf8')

const key = (value: string): string => value

let root: Root | undefined

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

async function mountWithParams(
  params?: Readonly<Record<string, string>>,
  resolveText: (value: string) => string = key
): Promise<HTMLButtonElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <Tooltip labelKey="ui.test.openApp" labelParams={params} resolveText={resolveText}>
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

/** 给元素装一个固定矩形：happy-dom 不做布局，不装的话所有矩形都是 0。 */
function stubRect(element: Element, top: number, left: number, width = 24, height = 24): void {
  const rect = { x: left, y: top, width, height, top, left, right: left + width, bottom: top + height, toJSON: () => ({}) }
  // `configurable: true`：同一条用例里要挪两次锚点。
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => rect })
}

/** 读弹层的行内定位（`left` / `top`）。位置是浮层自己算的，不是我们写的样式。 */
function popupPosition(): { left: number; top: number } | null {
  const popup = document.querySelector<HTMLElement>('.ant-tooltip')
  if (popup === null) return null
  const style = popup.style
  return { left: Number.parseFloat(style.left), top: Number.parseFloat(style.top) }
}

async function waitForPopup(): Promise<HTMLElement | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const popup = document.querySelector<HTMLElement>('.ant-tooltip')
    if (popup !== null) return popup
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  return null
}

/**
 * 等一个条件真的成立，而不是等一个固定时长：条件一成立就返回，上限用完才红。
 * 上限按「次数 × 10ms」算，不读系统时钟。
 */
async function waitUntil(condition: () => boolean, what: string, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  if (condition()) return
  throw new Error(`timed out waiting for ${what}`)
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

  it('fills the template with the caller-formatted value and leaves no placeholder behind', async () => {
    // 带对象的提示（「在 X 中打开」）靠这一条：模板在文案表，值由调用方格式化好传进来。
    const trigger = await mountWithParams(
      { app: 'Finder' },
      (value) => (value === 'ui.test.openApp' ? 'Open in {app}' : '')
    )
    await act(async () => {
      trigger.focus()
    })

    expect(await tooltipText(trigger)).toBe('Open in Finder')
    expect(await tooltipText(trigger)).not.toContain('{')
  })

  it('keeps a missing parameter visible instead of dropping it silently', async () => {
    // 和 `Popover` 同一条：缺参数在界面上看得见，比安静地少一个对象名好——
    // 后者会被读成一个完整的句子，读者看不出这里本应有内容。
    const trigger = await mountWithParams({}, (value) => (value === 'ui.test.openApp' ? 'Open in {app}' : ''))
    await act(async () => {
      trigger.focus()
    })

    expect(await tooltipText(trigger)).toBe('Open in {app}')
  })

  it('closes on Escape and keeps the focus where it was', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })
    expect(await tooltipText(trigger)).toBe('ui.test.hint')

    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    // 焦点不回跳是这条的契约；弹层本身要处于「非打开」态（antd 关闭后加 hidden 类）。
    // 弹层节点会留着做动画，但关闭后会被挪到屏幕外（antd 用 `-1000vw/-1000vh` 表示不可见）；
    // 真正的可见性由界面设计的真机 Esc 验收兜底，这里只钉「不再显示」与「焦点不回跳」。
    const hidden = (): boolean => {
      const popup = document.querySelector('.ant-tooltip')
      return popup === null ||
        popup.className.includes('hidden') ||
        popup.getAttribute('aria-hidden') === 'true' ||
        (popup.getAttribute('style') ?? '').includes('-1000')
    }
    // 关闭是异步的：等「不再可见」这个条件成立，不睡固定 20ms。
    await waitUntil(hidden, 'the tooltip to stop being visible')
    expect(document.activeElement).toBe(trigger)
    expect(hidden()).toBe(true)
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

  it('can carry runtime data verbatim, without turning it into a key', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const headline = '美联储维持利率不变'
    await act(async () => {
      root!.render(
        <Tooltip dataText={headline} resolveText={key}>
          <button type="button" data-trigger>
            trigger
          </button>
        </Tooltip>
      )
    })
    const trigger = host.querySelector<HTMLButtonElement>('[data-trigger]')!
    await act(async () => {
      trigger.focus()
    })
    // 数据原样显示，不被解析器改写、也不做占位符填充。
    expect(await tooltipText(trigger)).toBe(headline)
  })

  it('pins the bubble type size at 12px instead of inheriting the page', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })
    await tooltipText(trigger)

    // 读渲染值，不读常量：主题字号一改，这条会因为气泡跟着漂而变红。
    const bubble = document.querySelector<HTMLElement>('.ant-tooltip-inner')
    expect(bubble).not.toBeNull()
    expect(bubble?.style.fontSize).toBe('12px')
  })

  it('never swallows the pointer: the bubble passes clicks through to the control below', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })
    await tooltipText(trigger)

    // 读渲染值：容器与内容是两个节点，只给一个，另一个仍会接住点击。
    const popup = document.querySelector<HTMLElement>('.ant-tooltip')
    const bubble = document.querySelector<HTMLElement>('.ant-tooltip-inner')
    expect(popup).not.toBeNull()
    expect(bubble).not.toBeNull()
    expect(popup?.style.pointerEvents).toBe('none')
    expect(bubble?.style.pointerEvents).toBe('none')
  })

  it('rejects placement at the call site too, not only in its own props', () => {
    // 两处都要管：组件 props 里出现 `placement` 是红，调用点把 `placement` 传给 `<Tooltip>` 也是红。
    const offenders: string[] = []
    const roots = ['apps', 'platform', 'products']
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'].includes(entry.name)) continue
          walk(join(dir, entry.name))
          continue
        }
        if (!/\.tsx$/.test(entry.name)) continue
        if (entry.name === 'Tooltip.test.tsx') continue
        const file = join(dir, entry.name)
        const body = readFileSync(file, 'utf8')
        // 只看我们这件组件的调用点；仓库里还有直接 import antd `Tooltip` 的老代码，
        // 那些是迁移对象，不是本守卫的范围（它们正是 26 处清单里要换的东西）。
        if (!body.includes('@platform/ui/components/tooltip')) continue
        for (const match of body.matchAll(/<Tooltip\b/g)) {
          const window = body.slice(match.index ?? 0, (match.index ?? 0) + 400)
          const close = window.indexOf('/>')
          if (/\bplacement=/.test(close >= 0 ? window.slice(0, close) : window)) offenders.push(file)
        }
      }
    }
    for (const root of roots) walk(join(process.cwd(), root))

    expect(offenders).toEqual([])
    // 铁证在当前调用点为零：这条守卫只在有人开始传 placement 时才咬人。
    expect(source).toContain("const PLACEMENT = 'bottom' as const")
  })


  it('mounts the bubble under body and moves it with the trigger instead of leaving it at (0,0)', async () => {
    // 2026-11-02 用户报的「气泡显示不了 / 跑到整个应用左上角」：浮层拿不到锚点就按 (0,0) 定位。
    // 这里判两件事，而不是「气泡出现了」——出现了但位置是原点，读者照样看不见。
    const positionAt = async (top: number, left: number): Promise<{ left: number; top: number }> => {
      await act(async () => root?.unmount())
      document.body.replaceChildren()
      const trigger = await mount()
      stubRect(trigger, top, left)
      await act(async () => {
        trigger.focus()
      })
      const popup = await waitForPopup()
      expect(popup).not.toBeNull()
      // ① 挂到 body 下：触发器住在会 overflow:hidden 的面板/抽屉里也不会被裁掉。
      expect(popup?.parentElement).toBe(document.body)
      const position = popupPosition()
      expect(position).not.toBeNull()
      return position!
    }

    const first = await positionAt(300, 400)
    // 不在原点：这就是「气泡跑到左上角」那条症状的反面。
    expect(first.left).not.toBe(0)
    expect(first.top).not.toBe(0)

    // ② 换一个锚点位置挂第二遍：浮层位置必须按同样的位移跟着挪。
    // 这一条才是「锚点真的是那颗按钮」的证据——按 (0,0) 定位的浮层两次都会在原点。
    const second = await positionAt(600, 900)
    expect(second.left - first.left).toBe(500)
    expect(second.top - first.top).toBe(300)
  })
})
