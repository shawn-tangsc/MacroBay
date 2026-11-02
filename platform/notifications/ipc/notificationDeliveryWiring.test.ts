import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 投递钩子的接线守卫：**这一处断掉时，任何单测都不会红**——记录照样写进中心，开关照样是开着的，
 * 只是 `routeTransientDelivery` 发现 `hooks.toast` 缺席，把它记成 `skipped: toast-unavailable`。
 * 用户看到的就是「勾了开关、点了按钮，屏幕上什么都没有」，与假开关没有区别。
 *
 * 所以这里钉的是三处接缝必须同时在：运行时给钩子、IPC 有通道、preload 暴露订阅。
 */
const root = join(__dirname, '..', '..', '..')

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const runtime = read('platform/notifications/ipc/registerNotificationIpc.ts')
const channels = read('platform/desktop/ipc/channels.ts')
const preload = read('platform/desktop/preload/index.ts')

describe('应用内投递的接线', () => {
  it('运行时把 toast 与 popup 两个钩子都接上', () => {
    // 两个都要：只接 toast 的话，弹窗那档仍然是「勾了没反应」。
    expect(runtime).toContain('toast: (record) =>')
    expect(runtime).toContain('popup: (record) =>')
    expect(runtime).toContain('broadcastNotificationDelivered')
  })

  it('投递事件有自己的通道，不和「记录有变化」混用', () => {
    // 混用会让渲染层分不清「有新通知要弹」与「某条记录改了状态」，横幅会在标已读时也弹一次。
    expect(channels).toContain("notificationsDelivered: 'platform:notifications-delivered'")
    expect(channels).toContain("notificationsChanged: 'platform:notifications-changed'")
  })

  it('preload 暴露订阅并返回退订函数', () => {
    expect(preload).toContain('onDelivered:')
    expect(preload).toContain('IpcChannels.notificationsDelivered')
    // 退订：外壳切页或卸载后不该继续收事件。
    expect(preload).toMatch(/removeListener\(IpcChannels\.notificationsDelivered/)
  })
})
