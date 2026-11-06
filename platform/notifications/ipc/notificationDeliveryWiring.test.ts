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
// 桥面按命名空间拆分后，通知这一段住在这里；读错文件会让这条守卫永远绿（等于没守）。
const preload = read('platform/desktop/preload/namespaces/notifications.ts')
const composition = read('platform/desktop/main/composition/notifications.ts')

describe('应用内投递的接线', () => {
  it('运行时把 toast 与 popup 两个钩子都接上', () => {
    // 两个都要：只接 toast 的话，弹窗那档仍然是「勾了没反应」。
    // 通道方案 §2.2：两个钩子都收 (record, content)，且 content 由运行时解析一次。
    expect(runtime).toContain('toast: (record, content: NotificationDeliveryContent) =>')
    expect(runtime).toContain('popup: (record, content: NotificationDeliveryContent) =>')
    expect(runtime).toContain('broadcastNotificationDelivered')
    // 载荷必须走运行时那一个投影：横幅自己拼一份，就会和中心显示不同的句子。
    expect(runtime).toContain('toCenterItem(record, content)')
  })

  it('投递事件有自己的通道，不和「记录有变化」混用', () => {
    // 混用会让渲染层分不清「有新通知要弹」与「某条记录改了状态」，横幅会在标已读时也弹一次。
    expect(channels).toContain("notificationsDelivered: 'platform:notifications-delivered'")
    expect(channels).toContain("notificationsChanged: 'platform:notifications-changed'")
  })

  it('把可投递通道的投影接进运行时，否则设置页永远说「还没有可用通道」', () => {
    // 这一处断掉时不会有任何单测红：通道能发、CLI 证据也在，但 `getPushTargets` 缺席，
    // 运行时按「没有任何可投递通道」返回，界面把「能发」说成「没有」——最坏的一种谎。
    expect(composition).toContain('getPushTargets: async () => ports.channels.listDeliveryTargets().channels')
    expect(composition).toContain('...(ports.getPushTargets === undefined ? {} : { getPushTargets: ports.getPushTargets })')
  })

  it('preload 暴露订阅并返回退订函数', () => {
    expect(preload).toContain('onDelivered:')
    expect(preload).toContain('IpcChannels.notificationsDelivered')
    // 退订：外壳切页或卸载后不该继续收事件。
    expect(preload).toMatch(/removeListener\(IpcChannels\.notificationsDelivered/)
  })
})
