// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidePanel, SIDE_PANEL_SIZES } from './SidePanel'
import { PANEL_COLLAPSE_KEY, resolvePanelText } from './panelText'

const css = readFileSync(join(__dirname, 'sidePanel.css'), 'utf8')
const key = (value: string): string => value

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(overrides: Partial<Parameters<typeof SidePanel>[0]> = {}): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <SidePanel
        onClose={() => undefined}
        open
        resolveText={key}
        size="rail"
        titleKey="ui.test.panelTitle"
        {...overrides}>
        <button type="button" data-inner>
          inner
        </button>
      </SidePanel>
    )
  })
  return host
}

describe('SidePanel', () => {
  it('offers exactly two sizes and takes no pixel width', async () => {
    expect(SIDE_PANEL_SIZES).toEqual(['rail', 'flex'])

    const host = await mount({ size: 'rail' })
    const panel = host.querySelector<HTMLElement>('.side-panel')!
    expect(panel.style.getPropertyValue('--side-panel-width')).toBe('282px')
    // 根块的宽度只准来自变量；像素表在组件里（`SIZE_CSS`），不在样式表里。
    const rootStart = css.indexOf('.side-panel {')
    const rootBlock = css.slice(rootStart, css.indexOf('}', rootStart))
    expect(rootBlock).toContain('width: var(--side-panel-width)')
    expect(rootBlock).not.toMatch(/width:\s*\d+px/)
  })

  it('keeps the ratio cap inside the component for the flex size', async () => {
    const host = await mount({ size: 'flex' })
    const panel = host.querySelector<HTMLElement>('.side-panel')!
    expect(panel.style.getPropertyValue('--side-panel-width')).toBe('min(480px, 46vw)')
  })

  it('has no mask and does not lock focus', async () => {
    const host = await mount()
    expect(host.querySelector('.side-panel')).not.toBeNull()
    // 没有遮罩元素；也没有 role="dialog"——它不是模态。
    expect(document.querySelector('[class*="mask"]')).toBeNull()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(css).not.toContain('overscroll')
  })

  it('moves focus into the panel when it opens, and does not trap it', async () => {
    await mount()
    expect(document.activeElement?.hasAttribute('data-inner')).toBe(true)
    expect(css).not.toContain('focus-trap')
  })

  it('names the region through its heading instead of repeating the title twice', async () => {
    const host = await mount()
    const panel = host.querySelector<HTMLElement>('.side-panel')!
    const heading = host.querySelector<HTMLElement>('.side-panel__title')!

    // aria-label 与 <h2> 写同一句，读屏会先念区域名再念标题；所以只留 aria-labelledby。
    expect(panel.hasAttribute('aria-label')).toBe(false)
    expect(panel.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(heading.id).not.toBe('')
    expect(heading.textContent).toBe('ui.test.panelTitle')
  })

  it('renders no footer row when the caller passes none', async () => {
    const host = await mount()
    expect(host.querySelector('.side-panel__footer')).toBeNull()
  })

  it('renders the footer it is given, word for word', async () => {
    const host = await mount({ footer: <button type="button">save</button> })
    expect(host.querySelector('.side-panel__footer')?.textContent).toBe('save')
  })

  it('names the collapse control from its own copy table, never an empty string', async () => {
    const host = await mount()
    const collapse = host.querySelector<HTMLButtonElement>('.side-panel__header button')!
    expect(collapse.getAttribute('aria-label')).toBe(resolvePanelText('zh-CN', PANEL_COLLAPSE_KEY))
    expect(collapse.getAttribute('aria-label')).toBe('收起面板')
  })

  it('fades in through the motion token, with no duration literal of its own', () => {
    expect(css).toContain('animation: side-panel-fade var(--motion-enter)')
    // 组件里不许出现 ms/s 字面量：降级由 tokens.css 一处把 --motion-* 归零。
    expect(css).not.toMatch(/\b\d+(\.\d+)?m?s\b/)
    expect(css).not.toMatch(/@media\s*\(prefers-reduced-motion/)
    // 宽度不参与过渡：那会连续重排主内容。
    expect(css).not.toMatch(/transition:[^;]*width/)
  })

  it('gives focus back to whatever had it when the panel closes', async () => {
    const outside = document.createElement('button')
    outside.textContent = 'trigger'
    document.body.append(outside)
    outside.focus()

    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <SidePanel onClose={() => undefined} open resolveText={key} size="rail" titleKey="ui.test.panelTitle">
          <button type="button" data-inner>
            inner
          </button>
        </SidePanel>
      )
    })
    expect(document.activeElement?.hasAttribute('data-inner')).toBe(true)

    await act(async () => {
      root!.render(
        <SidePanel onClose={() => undefined} open={false} resolveText={key} size="rail" titleKey="ui.test.panelTitle">
          <button type="button" data-inner>
            inner
          </button>
        </SidePanel>
      )
    })
    // 谁移动了焦点谁负责还原：关掉之后焦点回到打开前那一个元素，不是掉到 body 上。
    expect(document.activeElement).toBe(outside)
  })

  it('leaves focus where it is in the stay policy: the reader is browsing a list', async () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()

    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <SidePanel contentId="event-1" focusPolicy="stay" when="10:30" onClose={() => undefined} open resolveText={key} size="flex" titleKey="ui.test.event">
          <button type="button" data-inner>
            inner
          </button>
        </SidePanel>
      )
    })

    // 焦点既不进入也不还原：读者正在列表里连着看。
    expect(document.activeElement).toBe(outside)
    expect(document.activeElement?.hasAttribute('data-inner')).toBe(false)
  })

  it('announces the new title once in stay, and only once for a burst of changes', async () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const render = async (titleKey: string, contentId: string, when = '10:30'): Promise<void> => {
      await act(async () => {
        root!.render(
          <SidePanel contentId={contentId} focusPolicy="stay" when={when} onClose={() => undefined} open resolveText={key} size="flex" titleKey={titleKey}>
            <button type="button">inner</button>
          </SidePanel>
        )
      })
    }

    await render('ui.test.eventA', 'id-a')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const announced = host.querySelector('[role="status"]')?.textContent ?? ''
    expect(announced).toContain('ui.test.eventA')
    // 模板化句子不许残留占位符：`{title}` 没填也会「包含那句话」，那是假绿。
    expect(announced).not.toContain('{')

    await render('ui.test.eventB', 'id-b')
    await render('ui.test.eventC', 'id-c')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    // 连点两个只播最后一个：读者要的是「换到了哪」，不是一段流水账。
    const status = host.querySelector('[role="status"]')?.textContent ?? ''
    expect(status).toContain('ui.test.eventC')
    expect(status).not.toContain('ui.test.eventB')
    vi.useRealTimers()
  })

  it('does not announce again when the same content renders twice', async () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    // 同一个 id、同一个标题重渲染：第二次不该再念一遍。
    for (const _ of [0, 1]) {
      await act(async () => {
        root!.render(
          <SidePanel contentId="same-id" focusPolicy="stay" when="10:30" onClose={() => undefined} open resolveText={key} size="flex" titleKey="ui.test.same">
            <button type="button">inner</button>
          </SidePanel>
        )
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
    }
    const status = host.querySelector('[role="status"]')?.textContent ?? ''
    expect(status).toContain('ui.test.same')
    expect(status.split('ui.test.same')).toHaveLength(2)
    vi.useRealTimers()
  })

  it('tells two same-named items apart in the announcement', async () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const render = async (contentId: string, when: string): Promise<void> => {
      await act(async () => {
        root!.render(
          <SidePanel contentId={contentId} focusPolicy="stay" when={when} onClose={() => undefined} open resolveText={key} size="flex" titleKey="ui.test.fomc">
            <button type="button">inner</button>
          </SidePanel>
        )
      })
    }

    await render('fomc-1', '10:30')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const first = host.querySelector('[role="status"]')?.textContent ?? ''

    await render('fomc-2', '14:00')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const second = host.querySelector('[role="status"]')?.textContent ?? ''

    // 同名不同 id：两句必须不一样，否则读者听到两遍同一句话，以为没换。
    expect(first).toContain('10:30')
    expect(second).toContain('14:00')
    expect(first).not.toBe(second)
    expect(second).not.toContain('{')
    vi.useRealTimers()
  })

  it('announces again when the panel is reopened on the same content', async () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const render = async (open: boolean): Promise<void> => {
      await act(async () => {
        root!.render(
          <SidePanel contentId="same" focusPolicy="stay" when="10:30" onClose={() => undefined} open={open} resolveText={key} size="flex" titleKey="ui.test.reopen">
            <button type="button">inner</button>
          </SidePanel>
        )
      })
    }

    await render(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(host.querySelector('[role="status"]')?.textContent).toContain('ui.test.reopen')

    await render(false)
    await render(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    // 重开是新的一轮：门闩复位，读者需要知道现在显示的是哪一条。
    expect(host.querySelector('[role="status"]')?.textContent).toContain('ui.test.reopen')
    vi.useRealTimers()
  })

  it('has no live region at all in the move-in policy', async () => {
    const host = await mount()
    // move-in 的焦点本身就会播报，再挂一层就是念两遍。
    expect(host.querySelector('[role="status"]')).toBeNull()
    expect(host.querySelector('[aria-live]')).toBeNull()
  })

  it('renders nothing at all while closed, leaving no empty shell', async () => {
    const host = await mount({ open: false })
    expect(host.querySelector('.side-panel')).toBeNull()
  })
})
