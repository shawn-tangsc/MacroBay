import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ userData: '', windows: [] as unknown[] }))
vi.mock('electron', () => ({
  app: { getPath: () => electron.userData },
  BrowserWindow: { getAllWindows: () => electron.windows },
  // 桌面通知在测试里没有系统通道：给一个能被 `new` 的假实现，`show()` 什么都不做。
  Notification: class {
    static isSupported(): boolean { return true }
    on(): void {}
    show(): void {}
  }
}))

import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '../contracts/platformNotificationEvents'
import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { configureNotificationRuntime, getNotificationRuntime, resetNotificationRuntimeForTests } from './registerNotificationIpc'

/**
 * 装配层必须把**同一个** `resolvePushChannel` 交给运行时（2026-11-08 的线上事故）。
 *
 * 事故形状：`configureNotificationRuntime` 收到了 composition 注入的派生入口，但它只被存进
 * `resolutionDeps`（给 IPC 自检/读数用），**没进运行时的 deps**。运行时内部三处都读
 * `deps.resolvePushChannel`，拿到 `undefined` 后各自兜底成 `NO_PUSH_CHANNEL`：
 * 每条通知写 `failed / push-unavailable`、push 端口一次不被调用、重投报 `channel-missing`——
 * 而通道页的「发送测试消息」走另一条路，照样能发，于是现场就成了「通道明明能用、推送整程静默失效」。
 *
 * 所以这里判的是「接线是不是同一根线」，不是「有没有兜底」：兜底本身正是当时的静默来源。
 */
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), 'notification-ipc-'))
  electron.userData = dir
  return dir
}

const catalog = createNotificationEventCatalog({
  sources: [
    // 自检那条事件走真实声明与批准：`sendTestNotice` 提交的正是 `platform.notification.self-test`。
    { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
    {
    productId: 'platform',
    events: [{
      id: 'platform.demo-push',
      titleKey: 'notification.event.platform.demo-push.title',
      reasonKey: 'notification.event.platform.demo-push.reason',
      bodyKey: 'notification.event.platform.demo-push.body',
      requiresUserAction: false,
      category: 'reminder',
      requestedDisruptionLevels: ['channel'],
      dedupeKeyTemplate: 'demo:{id}',
      dedupeUnit: 'occurrence'
    }],
    approval: { 'platform.demo-push': { approvedDisruptionLevels: ['center', 'channel'] as const, approvedBypassQuietHours: false } }
    }
  ]
})

function request(): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.demo-push',
    actions: [],
    dedupeVars: { builder: 'template', vars: { id: 'one' } },
    occurredAt: '2026-11-08T12:00:00.000Z'
  }
}

describe('the runtime gets the injected push-channel resolver', () => {
  let dir: string
  beforeEach(() => {
    dir = directory()
    resetNotificationRuntimeForTests()
  })
  afterEach(() => {
    resetNotificationRuntimeForTests()
    rmSync(dir, { recursive: true, force: true })
  })

  function configure(push = vi.fn(async () => ({ ok: true, messageId: 'm-1' }))) {
    const resolvePushChannel = vi.fn(async () => ({ ok: true as const, channelId: 'channel-a', channelName: 'Telegram · test' }))
    configureNotificationRuntime({
      // 三档都开着：这条判的是「派生入口接没接上」，不是读者关掉某一档时的回执（那有另一组用例）。
      getSettings: async () => ({ ...createDefaultNotificationRuntimeSettings(), desktopEnabled: true, toastEnabled: true }),
      clock: { now: () => new Date('2026-11-08T12:00:00.000Z'), timeZone: () => 'Asia/Shanghai' },
      getLanguage: async () => 'zh-CN',
      diagnostics: () => undefined,
      catalog,
      push,
      resolvePushChannel
    })
    return { push, resolvePushChannel }
  }

  it('hands the runtime the very resolver composition injected, not the no-channel fallback', async () => {
    const { resolvePushChannel } = configure()
    const runtime = getNotificationRuntime()
    await expect(runtime.resolvePushChannel()).resolves.toEqual({ ok: true, channelId: 'channel-a', channelName: 'Telegram · test' })
    expect(resolvePushChannel).toHaveBeenCalled()
  })

  it('the main push path really calls the channel port instead of writing push-unavailable', async () => {
    const { push } = configure()
    const runtime = getNotificationRuntime()
    const outcome = await runtime.submit(request())
    expect(outcome.kind).toBe('accepted')
    // 一次真实投递：端口被调用，记录上是 sent-accepted，而不是 failed/push-unavailable。
    expect(push).toHaveBeenCalledTimes(1)
    const record = (await runtime.list({ limit: 10 })).items[0]
    expect(record).toBeDefined()
    expect((record as unknown as { delivery?: { push?: { state?: string; reason?: string } } }).delivery?.push?.state).toBe('sent-accepted')
  })

  it('the three test buttons send through the same resolver, so they no longer report push-unavailable', async () => {
    configure()
    const runtime = getNotificationRuntime()
    await expect(runtime.sendTestNotice()).resolves.toEqual({ state: 'sent', channelId: 'channel-a', channelName: 'Telegram · test' })
  })
  it('refuses to build the singleton before configuration, instead of creating a push-dead runtime', async () => {
    // 装配顺序错了必须响亮失败：一个在装配前被造出来的运行时，本进程内永远不会再被修正。
    expect(() => getNotificationRuntime()).toThrow('notification-runtime-used-before-configuration')
    // 标记位随 `reset` 一起清掉：否则下一个用例会拿到上一轮「已装配」的残影。
    configure()
    expect(() => getNotificationRuntime()).not.toThrow()
    resetNotificationRuntimeForTests()
    expect(() => getNotificationRuntime()).toThrow('notification-runtime-used-before-configuration')
  })
})
