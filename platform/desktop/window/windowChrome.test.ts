import { describe, expect, it } from 'vitest'

import { IpcChannels } from '../ipc/channels'
import { resolveWindowChromeOptions, wireWindowChromeState } from './windowChrome'

/**
 * Owner: platform/desktop/window（**自绘标题栏的跨窗口策略**）。
 *
 * 判据只有两条：
 *  1) 平台 → 装饰的唯一映射（macOS 红绿灯内嵌；Windows 无原生标题条；其它平台不动）；
 *  2) 最大化/还原事实广播到**该窗口自己**的渲染器（自绘按钮的图形来源），且窗口已销毁/端口缺失时静默。
 */

type FakeWindow = {
  destroyed: boolean
  maximized: boolean
  sent: Array<{ channel: string; payload: unknown }>
  on: (event: string, listener: () => void) => void
  emit: (event: string) => void
  isDestroyed: () => boolean
  isMaximized: () => boolean
  webContents: { send?: (channel: string, payload: unknown) => void }
}

function createFakeWindow(): FakeWindow {
  const listeners = new Map<string, Array<() => void>>()
  const fake: FakeWindow = {
    destroyed: false,
    maximized: false,
    sent: [],
    on: (event, listener) => { listeners.set(event, [...(listeners.get(event) ?? []), listener]) },
    emit: (event) => { for (const listener of listeners.get(event) ?? []) listener() },
    isDestroyed: () => fake.destroyed,
    isMaximized: () => fake.maximized,
    webContents: { send: (channel, payload) => { fake.sent.push({ channel, payload }) } }
  }
  return fake
}

describe('窗口装饰：平台单源策略', () => {
  it('macOS：hiddenInset + 红绿灯内嵌位置（内容铺到窗口顶部）', () => {
    expect(resolveWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 }
    })
  })

  it('Windows：无原生边框（自绘标题栏），且不保留原生 titleBarStyle', () => {
    const options = resolveWindowChromeOptions('win32')
    expect(options.frame).toBe(false)
    // 有原生 titleBarStyle 就等于还有 OS 绘制的标题条，"顶部这一条"会回来
    expect(options.titleBarStyle).toBeUndefined()
    // 不传 thickFrame ⇒ Electron 默认 true：保留原生缩放边/阴影/贴边吸附/双击最大化
    expect(options).not.toHaveProperty('thickFrame')
  })

  it('其它平台：保留原生装饰（不为未验证平台改外观）', () => {
    expect(resolveWindowChromeOptions('linux')).toEqual({ titleBarStyle: 'default' })
  })
})

describe('窗口装饰：最大化/还原广播', () => {
  it('maximize/unmaximize 只发给该窗口自己的渲染器', () => {
    const window = createFakeWindow()
    wireWindowChromeState(window as unknown as Parameters<typeof wireWindowChromeState>[0])

    window.maximized = true
    window.emit('maximize')
    window.maximized = false
    window.emit('unmaximize')

    expect(window.sent).toEqual([
      { channel: IpcChannels.windowMaximizedChanged, payload: true },
      { channel: IpcChannels.windowMaximizedChanged, payload: false }
    ])
  })

  it('窗口已销毁 ⇒ 不再广播；端口缺失 ⇒ 不抛（外观事件绝不影响窗口语义）', () => {
    const window = createFakeWindow()
    wireWindowChromeState(window as unknown as Parameters<typeof wireWindowChromeState>[0])
    window.destroyed = true
    window.emit('maximize')
    expect(window.sent).toEqual([])

    const broken = createFakeWindow()
    delete broken.webContents.send
    wireWindowChromeState(broken as unknown as Parameters<typeof wireWindowChromeState>[0])
    expect(() => { broken.emit('maximize') }).not.toThrow()
    expect(broken.sent).toEqual([])
  })
})
