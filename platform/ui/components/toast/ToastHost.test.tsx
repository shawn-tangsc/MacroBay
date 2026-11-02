// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToastHost, useToast } from './ToastHost'
import { TOAST_CLOSE_KEY, resolveToastText } from './toastText'

const css = readFileSync(join(__dirname, 'toast.css'), 'utf8')
const key = (value: string): string => value

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function Probe({ calls }: { calls: Array<() => void> }): null {
  const toast = useToast()
  calls.push(() => toast.success({ titleKey: 'ui.test.saved' }))
  return null
}

async function mount(withHost = true): Promise<{ host: HTMLElement; calls: Array<() => void> }> {
  const host = document.createElement('div')
  document.body.append(host)
  const calls: Array<() => void> = []
  root = createRoot(host)
  await act(async () => {
    root!.render(
      withHost ? (
        <ToastHost resolveText={key}>
          <Probe calls={calls} />
        </ToastHost>
      ) : (
        <Probe calls={calls} />
      )
    )
  })
  return { host, calls }
}

describe('ToastHost', () => {
  it('keeps its region click-through, so the buttons underneath stay usable', async () => {
    const { host } = await mount()
    const region = host.querySelector<HTMLElement>('.toast-region')!

    // 宿主是隐形矩形：整块设成 none，只有单条提示自己 auto。
    expect(css).toMatch(/\.toast-region\s*\{[^}]*pointer-events:\s*none/)
    expect(css).toMatch(/\.toast\s*\{[^}]*pointer-events:\s*auto/)
    expect(region.getAttribute('aria-label')).toBe(resolveToastText('zh-CN', 'ui.toast.region'))
  })

  it('sits above the drawer layer, fixed in the host and not a prop', async () => {
    const { host } = await mount()
    expect(host.querySelector('.toast-region')).not.toBeNull()
    // over-drawer 是 1500；提示必须压得住弹窗，否则刚点完保存的提示会被盖住。
    expect(css).toMatch(/\.toast-region\s*\{[^}]*z-index:\s*1600/)
  })

  it('fails loudly when no host is mounted instead of silently dropping the toast', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // fail-closed：没有宿主就是编程错误，不许静默退化成「什么都不发生」。
    expect(() => renderToStaticMarkup(<Probe calls={[]} />)).toThrow(/ToastHost/)
    error.mockRestore()
  })

  it('names the close control from its own copy table, never an empty string', async () => {
    const { host, calls } = await mount()
    await act(async () => {
      calls[0]?.()
    })
    const close = host.querySelector<HTMLButtonElement>('.toast button')!
    expect(close.getAttribute('aria-label')).toBe(resolveToastText('zh-CN', TOAST_CLOSE_KEY))
    expect(close.getAttribute('aria-label')).toBe('关闭提示')
  })

  it('marks each toast as a polite status region rather than an alert', async () => {
    const { host, calls } = await mount()
    await act(async () => {
      calls[0]?.()
    })
    const item = host.querySelector('.toast')!
    expect(item.getAttribute('role')).toBe('status')
    expect(item.getAttribute('aria-live')).toBe('polite')
    // alert 是 assertive，会打断正在朗读的内容——这一条在 StateView 上已经否过一次。
    expect(item.getAttribute('role')).not.toBe('alert')
  })
})
