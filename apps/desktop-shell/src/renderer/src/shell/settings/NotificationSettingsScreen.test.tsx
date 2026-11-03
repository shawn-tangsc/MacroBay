// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { ChannelDeliveryTargetView } from '@platform/ai/agent-platform/channels/ChannelManagementContracts'
import type { NotificationEventCatalogEntry } from '@platform/notifications/contracts/notificationEventCatalog'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { NotificationSettingsScreen } from './NotificationSettingsScreen'
import { notificationSettingsText } from './notifications/notificationSettingsText'
import type { NotificationSettingsClient } from './notifications/useNotificationSettingsData'

let root: Root | undefined

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = undefined
  document.body.innerHTML = ''
})

function entry(overrides: Partial<NotificationEventCatalogEntry> = {}): NotificationEventCatalogEntry {
  return {
    id: 'platform.job.failed-terminal',
    titleKey: 'notification.job.failed',
    reasonKey: 'notification.reason.failed',
    requiresUserAction: true,
    requestedDisruptionLevels: ['desktop'],
    dedupeUnit: 'occurrence',
    notifyOnlyIfSubscribed: false,
    productId: 'platform',
    approvedDisruptionLevels: ['center', 'desktop'],
    approvedBypassQuietHours: false,
    ...overrides
  }
}

async function mount(client: NotificationSettingsClient): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      createElement(ShellTimeZoneProvider, {
        timeZone: 'Asia/Shanghai',
        children: createElement(NotificationSettingsScreen, {
          title: '通知',
          language: 'zh-CN',
          client
        })
      })
    )
  })
  return container
}

describe('desktop notification permission is not a fake state', () => {
  it('says what we cannot read, where to turn it on, and how to check it ourselves', async () => {
    const container = await mount({
      listEventCatalog: async () => [],
      getSubscriptions: async () => ({}),
      getDeliverySettings: async () => ({ toastEnabled: false })
    })
    await act(async () => {
      await Promise.resolve()
    })

    const hint = container.querySelector('[data-desktop-cannot-read]')
    expect(hint?.textContent).toContain('读不到')
    expect(hint?.textContent).toContain('系统设置 › 通知 › MacroBay')
    expect(hint?.textContent).toContain('发送测试通知')

    // 三档状态词一个都不许出现：Electron 读不到系统开关，画出来就是一句恒定的假结论。
    expect(container.textContent).not.toContain('系统已放行')
    expect(container.textContent).not.toContain('暂时无法确认')
    // 「去系统设置」那条链已删（`openExternal` 只放行 http(s)，点了会抛错）。
    expect(container.textContent).not.toContain('去系统设置')
    expect(container.querySelector('[data-row="desktop"] .status-pill')).toBeNull()
  })
})

describe('the event name column never shows an internal key', () => {
  it('names the rows the reader subscribed to, in both products and the platform', async () => {
    const container = await mount({
      listEventCatalog: () =>
        Promise.resolve([
          entry(),
          entry({ id: 'market-intelligence.briefing.failed', titleKey: 'notification.event.market-intelligence.briefing.failed.title', productId: 'market-intelligence' })
        ]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false })
    })

    const names = [...container.querySelectorAll('.notification-subs-name')].map((node) => node.textContent)
    expect(names).toContain('任务跑到终态仍失败')
    // 产品事件名同样读得出来：这一行以前会直接印出 `notification.event.market-intelligence.…`。
    expect(names).toContain('日报没生成出来')
  })

  it('says the name cannot be read instead of printing the key when there is no name for it', async () => {
    const container = await mount({
      listEventCatalog: () =>
        Promise.resolve([
          entry({ id: 'platform.something.new', titleKey: 'notification.something.new.title', productId: 'platform' })
        ]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false })
    })

    const name = container.querySelector('.notification-subs-name')?.textContent ?? ''
    expect(name).toBe('这一条的名称暂时读不出来')
    // 兜底不许回显键名，也不许把事件 id 当文字。
    expect(name).not.toContain('notification.')
    expect(name).not.toContain('platform.something.new')
  })
})

describe('notification settings screen', () => {
  it('waits with the platform loading surface instead of drawing an empty form', async () => {
    const container = await mount({
      listEventCatalog: () => new Promise(() => undefined),
      getSubscriptions: () => new Promise(() => undefined),
      getDeliverySettings: () => new Promise(() => undefined),
    })

    expect(container.querySelector('[data-loading-state], .loading-state')).not.toBeNull()
  })

  it('says the read failed instead of saying there is nothing to subscribe to', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.reject(new Error('boom')),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({}),
    })

    // 「读不到」与「没有」是两件事：这里绝不能说清单为空。
    expect(container.textContent).not.toContain('现在还没有可以订阅的事件')
    expect(container.querySelector('[data-state="error"]')).not.toBeNull()
  })

  it('draws the three cell forms: fixed label, unapproved dash, and a real checkbox', async () => {
    const container = await mount({
      listEventCatalog: () =>
        Promise.resolve([
          entry(),
          entry({
            id: 'market-intelligence.briefing.analyzed',
            titleKey: 'notification.briefing.analyzed',
            productId: 'market-intelligence',
            notifyOnlyIfSubscribed: true,
            // 只批了中心：桌面列是未批准 —— 这一格必须是灰色「—」，不是禁用的勾。
            approvedDisruptionLevels: ['center']
          })
        ]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false }),
    })

    // 无条件记录的事件：标签，不是控件。
    expect(container.querySelectorAll('.notification-subs-fixed').length).toBeGreaterThan(1)
    // 未批准的格子只出现「—」：它是文字，不是任何形态的控件。
    expect(container.querySelectorAll('.notification-subs-dash').length).toBeGreaterThan(0)
    // 结果类事件的记录格是可勾的。
    const recordBoxes = container.querySelectorAll('input[type="checkbox"][aria-label*="记录"]')
    expect(recordBoxes.length).toBe(1)
  })

  it('keeps the four on-device rows and adds the outbound channel row', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false }),
    })

    expect(container.querySelector('[data-row="center"]')).not.toBeNull()
    expect(container.querySelector('[data-row="toast"]')).not.toBeNull()
    expect(container.querySelector('[data-row="desktop"]')).not.toBeNull()
    expect(container.querySelector('[data-row="popup"]')).not.toBeNull()
    expect(container.querySelector('[data-row="channel"]')).not.toBeNull()
  })

  it('tells an empty catalog apart from a failed read', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false }),
    })

    expect(container.querySelector('[data-subs-empty]')).not.toBeNull()
    // 空不等于错：这里不该出现错误视图。
    expect(container.querySelector('[data-state="error"]')).toBeNull()
  })
})

function channelTarget(overrides: Partial<ChannelDeliveryTargetView> = {}): ChannelDeliveryTargetView {
  return {
    id: 'telegram-1',
    name: 'Telegram · 观潮播报',
    deliverable: true,
    reason: null,
    target: { kind: 'bound', conversationKind: 'direct' },
    ...overrides
  }
}

/**
 * 「发送到频道」这一行（U3 / U10）：没有频道时只给原因与「去接入」，有频道时给选择器、
 * 目标（只读）和状态；两种情况都不许出现行开关——开关在下面清单的频道列里。
 */
describe('the send-to-channel row', () => {
  it('offers no selector and one way forward when nothing can deliver', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false })
    })

    const row = container.querySelector('[data-row="channel"]')
    // 空下拉会把「没有」说成「挑一个」。
    expect(row?.querySelector('select')).toBeNull()
    expect(row?.textContent).toContain('还没有可用频道')
    // 启用改成现场自检之后，「需要一条真机验证记录才能启用」是句假话（设置页规范 v2.17），
    // 这一行也不许把人往「去别处跑步骤」引。
    expect(row?.textContent).not.toContain('真机验证记录')
    expect(row?.querySelector('.status-pill')?.textContent).toBe('未接入')
    expect([...row!.querySelectorAll('button')].map((node) => node.textContent)).toEqual(['去接入'])
    // 这一行永远没有开关：推送由清单的频道列决定。
    expect(row?.querySelector('[role="switch"], input[type="checkbox"]')).toBeNull()
  })

  it('sends the reader to the channel page from its one action, instead of a dead button', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false })
    })
    const navigations: unknown[] = []
    const listener = (event: Event): void => {
      navigations.push((event as CustomEvent).detail)
    }
    window.addEventListener('app-shell:navigate', listener)

    const button = container.querySelector('[data-row="channel"] button')
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    window.removeEventListener('app-shell:navigate', listener)

    // 频道页是唯一能接入/绑目标的地方：按钮必须真的把人送过去。
    expect(navigations).toEqual([{ navKey: 'settings', settingsPanelKey: 'channels' }])
  })

  it('lists only the channels that can deliver, and says pushing is off until one is picked', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () =>
        Promise.resolve({
          channels: [
            channelTarget(),
            channelTarget({ id: 'slack-1', name: 'Slack · 实验室', deliverable: false, reason: 'not-enabled' })
          ],
          channelId: null,
          toastEnabled: false
        })
    })

    const row = container.querySelector('[data-row="channel"]')!
    const options = [...row.querySelectorAll('select option')].map((node) => node.textContent)
    // U10：只有接得上的那一条出现在这里，没验证过的不出现、也不留灰格。
    expect(options).toContain('Telegram · 观潮播报')
    expect(options).not.toContain('Slack · 实验室')
    // 有频道但没选 ≠ 未接入。
    expect(row.textContent).toContain('还没有选频道')
    expect(row.textContent).not.toContain('还没有可用频道')
  })

  it('shows the bound target read-only and stays quiet when the channel is ready', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () =>
        Promise.resolve({ channels: [channelTarget()], channelId: 'telegram-1', toastEnabled: false })
    })

    const row = container.querySelector('[data-row="channel"]')!
    expect(row.querySelector('[data-channel-target]')?.textContent).toBe('目标私聊')
    // 成功不打标：没有药丸、没有句子。
    expect(row.querySelector('.status-pill')).toBeNull()
    expect(row.querySelector('[data-channel-state]')).toBeNull()
  })

  it('names a broadcast conversation as a broadcast channel, not as the feature itself', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () =>
        Promise.resolve({
          channels: [channelTarget({ target: { kind: 'bound', conversationKind: 'channel' } })],
          channelId: 'telegram-1',
          toastEnabled: false
        })
    })

    // 「频道」是功能名，「广播频道」是会话类型：两个词不许再撞在一起。
    const target = container.querySelector('[data-row="channel"] [data-channel-target]')
    expect(target?.textContent).toBe('目标广播频道')
  })

  it('writes the last failure with the reader time zone and never claims it arrived', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () =>
        Promise.resolve({
          channels: [channelTarget()],
          channelId: 'telegram-1',
          lastPushFailureAt: '2026-11-02T13:37:00.000Z',
          lastPushFailureReason: 'channel-rejected',
          toastEnabled: false
        })
    })

    const row = container.querySelector('[data-row="channel"]')!
    expect(row.querySelector('.status-pill')?.textContent).toBe('推送失败')
    // 原因说人话、时刻带时区（GMT+8）：都是这一行要回答的问题，不是原始 ISO 也不是原因码。
    expect(row.textContent).toContain('频道拒收了这条')
    expect(row.textContent).toContain('11-02 21:37 GMT+8')
    expect(row.textContent).not.toContain('2026-11-02T13:37')
    expect(row.textContent).not.toContain('channel-rejected')
    expect(row.textContent).not.toContain('已送达')
  })

  it('does not claim the push failed when the channel cannot say whether it arrived', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () =>
        Promise.resolve({
          channels: [channelTarget()],
          channelId: 'telegram-1',
          lastPushFailureAt: '2026-11-02T13:37:00.000Z',
          lastPushFailureReason: 'unknown-after-send',
          toastEnabled: false
        })
    })

    const row = container.querySelector('[data-row="channel"]')!
    // 交出去了、没拿到回执：既不能写「没发出去」，也不能借「推送失败」那档药丸。
    expect(row.textContent).toContain('不确定有没有发到手机')
    expect(row.textContent).toContain('没有拿到确认')
    expect(row.textContent).not.toContain('没发出去')
    // 药丸要有，但只能是「不确定」那一档；状态词给不出来就是又一个假状态。
    const pill = row.querySelector('.status-pill')
    expect(pill?.textContent).toBe('不确定')
    expect(pill?.classList.contains('status-pill--muted')).toBe(true)
    expect(row.textContent).not.toContain('推送失败')
    // 「拿不到」不许写成「看到了」：这一档一个「已送达」都不许出现。
    expect(row.textContent).not.toContain('已送达')
    // 码本身不进原因映射表：否则以后又会被别的路径拼回「没发出去」的模板。
    for (const language of ['zh-CN', 'en-US'] as const) {
      expect(Object.keys(notificationSettingsText[language].pushFailureReason)).not.toContain('unknown-after-send')
    }
    // 时刻照样带时区。
    expect(row.textContent).toContain('11-02 21:37 GMT+8')
  })

  it('says the reason was not reported instead of printing an unknown code', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () =>
        Promise.resolve({
          channels: [channelTarget()],
          channelId: 'telegram-1',
          lastPushFailureAt: '2026-11-02T13:37:00.000Z',
          lastPushFailureReason: 'some-new-code',
          toastEnabled: false
        })
    })

    const row = container.querySelector('[data-row="channel"]')!
    expect(row.textContent).toContain('这次没留下原因')
    expect(row.textContent).not.toContain('some-new-code')
  })

  it('goes to the channel page for a target that is missing or ambiguous', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () =>
        Promise.resolve({
          channels: [channelTarget({ target: { kind: 'ambiguous', count: 2 } })],
          channelId: 'telegram-1',
          toastEnabled: false
        })
    })

    const row = container.querySelector('[data-row="channel"]')!
    expect(row.textContent).toContain('绑了多个会话')
    expect([...row.querySelectorAll('button')].map((node) => node.textContent)).toEqual(['去检查'])
  })
})

/**
 * 订阅清单的第三列（U3/U10 的另一半）：就绪前整列不出现，就绪后批准含 channel 的才是勾，
 * 其余是灰色「—」，不是置灰的勾。
 */
describe('the channel column', () => {
  it('is absent while the channel is not ready', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([entry()]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false })
    })

    expect(container.querySelector('[data-channel-column]')?.getAttribute('data-channel-column')).toBe('hidden')
    expect(container.textContent).not.toContain('这条不会到手机')
  })

  it('leaves a sentence behind when it hides, so nobody thinks a tick was lost', async () => {
    const container = await mount({
      listEventCatalog: () =>
        Promise.resolve([entry({ id: 'platform.signal', approvedDisruptionLevels: ['center', 'desktop', 'channel'] })]),
      // 读者早先勾过频道，现在频道没就绪：列不出现，但订阅还在。
      getSubscriptions: () => Promise.resolve({ 'platform.signal': { channel: true } }),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false })
    })

    const line = container.querySelector('[data-channel-column-pending]')
    expect(line?.textContent).toContain('已勾过频道的 1 条')
    expect(line?.textContent).toContain('不代表订阅被取消')
  })

  it('does not apologise for a column that is on screen, nor when nothing was ticked', async () => {
    const shown = await mount({
      listEventCatalog: () => Promise.resolve([entry({ approvedDisruptionLevels: ['center', 'desktop', 'channel'] })]),
      getSubscriptions: () => Promise.resolve({ 'platform.job.failed-terminal': { channel: true } }),
      getDeliverySettings: () =>
        Promise.resolve({ channels: [channelTarget()], channelId: 'telegram-1', toastEnabled: false })
    })
    // 列在页面上时订阅看得见，不需要这句解释。
    expect(shown.querySelector('[data-channel-column-pending]')).toBeNull()

    await act(async () => root?.unmount())
    root = undefined
    document.body.innerHTML = ''

    const empty = await mount({
      listEventCatalog: () => Promise.resolve([entry()]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false })
    })
    // 没有勾过频道：没有东西要解释。
    expect(empty.querySelector('[data-channel-column-pending]')).toBeNull()
  })

  it('appears with a real tick for approved events and a dash for the rest', async () => {
    const container = await mount({
      listEventCatalog: () =>
        Promise.resolve([
          entry({ id: 'platform.signal', approvedDisruptionLevels: ['center', 'desktop', 'channel'] }),
          entry({ id: 'platform.other', approvedDisruptionLevels: ['center', 'desktop'] })
        ]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () =>
        Promise.resolve({ channels: [channelTarget()], channelId: 'telegram-1', toastEnabled: false }),
      setSubscription: () => Promise.resolve()
    })

    expect(container.querySelector('[data-channel-column]')?.getAttribute('data-channel-column')).toBe('shown')
    const channelBoxes = container.querySelectorAll('input[type="checkbox"][aria-label*="频道"]')
    // 只有批准含 channel 的那一行是控件；另一行是灰色「—」。
    expect(channelBoxes.length).toBe(1)
    expect(container.querySelectorAll('.notification-subs-dash').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('这条不会到手机')
  })
})

/**
 * 写操作必须看回执。
 *
 * 订阅写入失败时是**正常返回** `{ ok:false, reasonCode }`（不抛错），提示开关失败时是抛错。
 * 两种都不能让勾选/开关自己亮起来：这一屏的每个勾都是「以后会这样发生」的承诺，
 * 亮着而库里没有，就是又一次「界面说存好了」。
 */
describe('a write that did not land does not leave the control looking saved', () => {
  it('keeps the record box unchecked and says it was not saved when the write is refused', async () => {
    const container = await mount({
      // 只有 `notifyOnlyIfSubscribed` 的事件，记录格才是可勾的控件（其余是无条件记录的文字）。
      listEventCatalog: () => Promise.resolve([entry({ notifyOnlyIfSubscribed: true })]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false }),
      setSubscription: async () => ({ ok: false, reasonCode: 'scope-mismatch' })
    })

    const box = container.querySelector('input[type="checkbox"][aria-label*="记录"]') as HTMLInputElement
    await act(async () => {
      box.click()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-notification-write-failed]')?.textContent).toContain(
      notificationSettingsText['zh-CN'].writeFailed
    )
    expect((container.querySelector('input[type="checkbox"][aria-label*="记录"]') as HTMLInputElement).checked).toBe(false)
    // 内部原因码不上屏。
    expect(container.textContent).not.toContain('scope-mismatch')
  })

  it('keeps the toast switch off and says it was not saved when the write throws', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false }),
      setToastEnabled: async () => {
        throw new Error('ipc-unavailable')
      }
    })

    const toastSwitch = container.querySelector('[data-row="toast"] [role="switch"]') as HTMLElement | null
    await act(async () => {
      toastSwitch?.click()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-notification-write-failed]')).not.toBeNull()
    expect(container.textContent).not.toContain('ipc-unavailable')
  })
})
