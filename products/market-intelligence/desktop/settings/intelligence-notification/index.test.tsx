// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { DEFAULT_CALENDAR_REMINDER_SETTINGS } from '../../../contracts/calendarEventReminder'
import { intelligenceNotificationText } from './text'
import IntelligenceNotificationSettingsSection, { itemForFocus } from './index'
import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { INTELLIGENCE_CHANNEL_EVENT_ROWS } from './useChannelEventSettings'

/**
 * 这一页的判据（界面规范 §9d–§9f）：左列表四项、默认选中第一项、关着只写在状态词里；
 * 「日历事件」一项里时间线 + 一处表面选择（管两条）+ 开始前 + 发生后。
 */

const text = intelligenceNotificationText['zh-CN']
const IDS = {
  signal: 'market-intelligence.signal.triggered',
  macro: 'market-intelligence.macro.event-landed',
  briefing: 'market-intelligence.briefing.ready'
} as const

type Stubs = {
  getChannelEvents: ReturnType<typeof vi.fn>
  setChannelEvent: ReturnType<typeof vi.fn>
  getDeliverySettings: ReturnType<typeof vi.fn>
  getSurfaceSelection: ReturnType<typeof vi.fn>
  setSurfaceSelection: ReturnType<typeof vi.fn>
  sendTest: Mock<(payload?: unknown) => Promise<unknown>>
  productsInvoke: ReturnType<typeof vi.fn>
}

function install(overrides: Partial<Stubs> = {}): Stubs {
  // 三枚按钮走**产品自己的 IPC**（`intelligence.sendTestNotification`），不再调平台的链路自检。
  const sendTest = overrides.sendTest
    ?? vi.fn(async (_payload: unknown) => ({ state: 'sent' as const, channelId: 'slack', channelName: 'Slack' }))
  const productsInvoke = overrides.productsInvoke ?? vi.fn(async (_productId: string, method: string, payload?: unknown) => {
    if (String(method).includes('sendTestNotification')) return sendTest(payload)
    if (String(method).includes('getNewsPushThreshold') || String(method).includes('saveNewsPushThreshold')) {
      return { pushThreshold: 'medium' }
    }
    if (String(method).includes('getNewsPushOutletState') || String(method).includes('setNewsPushOutletEnabled')) {
      return { enabled: true }
    }
    if (String(method).includes('getCalendarReminderSettings')) {
      return { enabled: false, leadMinutes: 60, importance: ['high'], landedFilter: 'surprise-only' }
    }
    if (String(method).includes('setCalendarReminderSettings')) {
      return { enabled: true, leadMinutes: 60, importance: ['high'], landedFilter: 'surprise-only' }
    }
    return { enabled: false }
  })
  const stubs: Stubs = {
    getChannelEvents: overrides.getChannelEvents
      ?? vi.fn(async () => ({ [IDS.signal]: true, [IDS.briefing]: true, [IDS.macro]: true })),
    setChannelEvent: overrides.setChannelEvent
      ?? vi.fn(async (eventId: string, enabled: boolean) => ({ eventId, enabled })),
    getDeliverySettings: overrides.getDeliverySettings
      ?? vi.fn(async () => ({ toastEnabled: true, desktopEnabled: false, pushWired: true, channels: [], lastPushFailureAt: null, lastPushFailureReason: null })),
    getSurfaceSelection: overrides.getSurfaceSelection
      ?? vi.fn(async () => ({ key: 'calendar-events', available: ['channel', 'toast'], selection: { channel: true, toast: true }, conflict: false })),
    setSurfaceSelection: overrides.setSurfaceSelection
      ?? vi.fn(async () => ({ key: 'calendar-events', available: ['channel', 'toast'], selection: { channel: true, toast: true }, conflict: false })),
    sendTest,
    productsInvoke
  }
  ;(window as unknown as { platform: unknown }).platform = {
    notifications: {
      getChannelEvents: stubs.getChannelEvents,
      setChannelEvent: stubs.setChannelEvent,
      getDeliverySettings: stubs.getDeliverySettings,
      getSurfaceSelection: stubs.getSurfaceSelection,
      setSurfaceSelection: stubs.setSurfaceSelection
    },
    products: { invoke: stubs.productsInvoke }
  }
  return stubs
}

let root: Root | undefined
let container: HTMLDivElement | undefined

async function render(focusEntityId?: string): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <ShellLanguageProvider language="zh-CN">
        <IntelligenceNotificationSettingsSection {...(focusEntityId === undefined ? {} : { focusEntityId })} />
      </ShellLanguageProvider>
    )
  })
  await act(async () => { await Promise.resolve() })
  return container
}

function listItems(): HTMLButtonElement[] {
  return [...(container?.querySelectorAll<HTMLButtonElement>('.intelligence-notification-list-item') ?? [])]
}

async function selectItem(index: number): Promise<void> {
  await act(async () => { listItems()[index]?.click(); await Promise.resolve() })
}

/** 读一个分段控件当前选中的那一项（`Segmented` 是 group + aria-pressed，不是 tablist）。 */
function pressedLabel(groupLabel: string): string | null {
  const group = [...(container?.querySelectorAll('[role="group"]') ?? [])]
    .find((node) => node.getAttribute('aria-label') === groupLabel)
  return group?.querySelector('[aria-pressed="true"]')?.textContent ?? null
}

/**
 * 断点量的是**这一页自己的宽度**（规范 §9f 的「容器宽」），不是窗口宽——外壳的三列里
 * 这一页只占一块。测试直接驱动这个宽度：`clientWidth` 在 happy-dom 里恒为 0，不 stub 就
 * 永远走「窗口宽」的兜底，量出来的不是被测对象。
 */
let sectionWidth = 1280
beforeEach(() => {
  sectionWidth = 1280
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('intelligence-notification-workspace') ? sectionWidth : 0
    }
  })
  install()
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
  delete (window as unknown as { platform?: unknown }).platform
  vi.restoreAllMocks()
})

describe('row-to-event binding', () => {
  it('binds every row to its own event id, in page order', () => {
    // 标题键 → 事件 id 的**有序**对照：补一行、删一行、换顺序都要红。
    // 舆情行曾经借 `macro.event-landed`，所以这里按整表断言，而不是逐条查存在。
    expect(INTELLIGENCE_CHANNEL_EVENT_ROWS.map((row) => [row.titleKey, row.eventId])).toEqual([
      ['pages.intelligence.notification.rows.signalTriggered.title', 'market-intelligence.signal.triggered'],
      ['pages.intelligence.notification.rows.briefingReady.title', 'market-intelligence.briefing.ready'],
      ['pages.intelligence.notification.rows.sentimentAlert.title', 'market-intelligence.sentiment.alert'],
      ['pages.intelligence.notification.rows.calendar.title', 'market-intelligence.calendar.event-upcoming']
    ])
    // 每个 id 都必须在 manifest 里声明过——表里写一个拼错的 id，这里就红。
    const declared = new Set(marketIntelligenceProductManifest.notificationEvents.map((event) => event.id))
    for (const row of INTELLIGENCE_CHANNEL_EVENT_ROWS) expect(declared.has(row.eventId), row.itemKey).toBe(true)
    // 走 `channelEvents` 的两行必须是平台批准过 `channel` 档的，否则开关存不进去。
    const channelApproved = new Set(['market-intelligence.signal.triggered', 'market-intelligence.briefing.ready'])
    for (const row of INTELLIGENCE_CHANNEL_EVENT_ROWS.filter((entry) => entry.control === 'channel-event')) {
      expect(channelApproved.has(row.eventId), row.itemKey).toBe(true)
    }
  })

  it('lands a deep link on the row that owns the event id', () => {
    expect(itemForFocus('market-intelligence.signal.triggered')).toBe('signal')
    expect(itemForFocus('market-intelligence.briefing.ready')).toBe('briefing')
    // 舆情通知必须落到舆情行：这正是借用 id 时坏掉的一条。
    expect(itemForFocus('market-intelligence.sentiment.alert')).toBe('sentiment')
    expect(itemForFocus('market-intelligence.calendar.event-upcoming')).toBe('calendar')
    // 宏观事件与日历共用一组表面选择，定位到日历行。
    expect(itemForFocus('market-intelligence.macro.event-landed')).toBe('calendar')
    expect(itemForFocus(undefined)).toBe('signal')
  })
})

describe('intelligence notification settings', () => {
  it('lists four items, selects the first, and folds the landed notice into the calendar item', async () => {
    await render()
    const names = listItems().map((item) => item.querySelector('.intelligence-notification-list-name')?.textContent)
    expect(names).toEqual([
      text['pages.intelligence.notification.rows.signalTriggered.title'],
      text['pages.intelligence.notification.rows.briefingReady.title'],
      text['pages.intelligence.notification.rows.sentimentAlert.title'],
      text['pages.intelligence.notification.rows.calendar.title']
    ])
    // 「宏观事件落地」不再单独占一项——它就是「日历事件 → 发生后」。
    expect(names).not.toContain(text['pages.intelligence.notification.rows.macroEventLanded.title'])
    expect(listItems()[0]?.getAttribute('aria-current')).toBe('true')
  })

  it('keeps explanatory prose off the page: field names, current values and controls only', async () => {
    // 用户 2026-11-07：没用的说明性文字不要直接展示。页脚整句已删，解释都进了 ⓘ。
    await render()
    await selectItem(3)
    const body = container?.textContent ?? ''
    // 「提醒的是重要经济指标…」是整句解释，只许在 ⓘ 里，不许出现在正文。
    expect(body).not.toContain(text['pages.intelligence.notification.calendar.beforeNote'])
    // 解释还在，只是要点开：两个 ⓘ 的读屏名都在。
    const labels = [...(container?.querySelectorAll('button[aria-label]') ?? [])]
      .map((button) => button.getAttribute('aria-label'))
    expect(labels).toContain(text['pages.intelligence.notification.calendar.aboutAria'])
    expect(labels).toContain(text['pages.intelligence.notification.calendar.beforeAria'])
    // 页脚那句整句删掉了（它不是操作也不是状态）。
    expect(body).not.toContain('只有这四条会发到手机')
  })

  it('gives every row exactly two cells: the 160 label column and the control column', async () => {
    // 行的语法（§8.2）：标签 + 控件。第三格会自动排到下一行，正是这次布局坏掉的那个形状；
    // 所以断言「每行恰好两个子元素」，而不是只看「有没有渲染出这一行」。
    install({
      productsInvoke: vi.fn(async (_productId: string, method: string) => {
        if (String(method).includes('getCalendarReminderSettings')) {
          return { enabled: true, leadMinutes: 60, importance: ['high'], landedFilter: 'also-matched' }
        }
        return { enabled: false }
      })
    })
    await render()
    await selectItem(3)
    const rows = [...(container?.querySelectorAll('.intelligence-notification-form-row') ?? [])]
    // 打开时完整形态：通知方式 / 开始前提醒 / 提前多久 / 哪些重要性 / 发生后 / 代价说明。
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      const cells = [...row.children]
      expect(cells).toHaveLength(2)
      expect(cells[0]?.classList.contains('intelligence-notification-form-label')).toBe(true)
      expect(cells[1]?.classList.contains('intelligence-notification-form-control')).toBe(true)
    }
    // 整块详情放在一张卡里（620 上限、左对齐），不是一个带内边距的裸容器。
    expect(container?.querySelectorAll('.intelligence-notification-card')).toHaveLength(1)
  })

  it('keeps the grid to exactly two children, with the head outside it', async () => {
    // 上一版把 标题 / 列表 / 详情 三个块塞进两列网格：自动排布把标题放窄格、详情挤到第二行。
    // 这条断言抓的就是那个形状——只量 resolveNotificationLayout() 的数字抓不到它。
    await render()
    const panes = container?.querySelector('.intelligence-notification-panes')
    expect(panes).not.toBeNull()
    const children = [...(panes?.children ?? [])]
    expect(children).toHaveLength(2)
    expect(children[0]?.classList.contains('intelligence-notification-list')).toBe(true)
    expect(children[1]?.classList.contains('intelligence-notification-detail')).toBe(true)
    const head = container?.querySelector('.intelligence-notification-head')
    expect(head).not.toBeNull()
    expect(panes?.contains(head ?? null)).toBe(false)
  })

  it('shows the calendar detail with one surface choice and both segments', async () => {
    await render()
    await selectItem(3)
    const body = container?.textContent ?? ''
    // 自制时间线已删（装饰、零信息量）；两个小节标题本身就说顺序。
    expect(body).not.toContain('开始前 ——')
    expect(body).toContain(text['pages.intelligence.notification.calendar.surfaces']!)
    // 字段名是「通知方式」，不是「发到哪里地方」。
    expect(body).toContain(text['pages.intelligence.notification.calendar.surfaceRow']!)
    expect(body).toContain(text['pages.intelligence.notification.surface.channel']!)
    expect(body).toContain(text['pages.intelligence.notification.surface.toast']!)
    expect(body).toContain(text['pages.intelligence.notification.calendar.before']!)
    expect(body).toContain(text['pages.intelligence.notification.calendar.after']!)
    // 「发到哪些地方」是整项级，排在两段**之上**。
    expect(body.indexOf(text['pages.intelligence.notification.calendar.surfaces']!))
      .toBeLessThan(body.indexOf(text['pages.intelligence.notification.calendar.before']!))
    // 桌面两条都没批 → 这一项的详情里根本不该出现桌面（页脚那句是另一件事）。
    const detail = container?.querySelector('.intelligence-notification-calendar-detail')?.textContent ?? ''
    expect(detail).not.toContain('桌面')
    // 状态词只在列表里出现一次，详情标题不再重复同一个名字。
    expect(container?.querySelector('.intelligence-notification-detail-title')).toBeNull()
  })

  it('lands on the matching item when the notification centre sends the reader here', async () => {
    // 从「去设置」进来：日历相关落「日历事件」，内容类落它自己那一项，认不出落第一项。
    await render('market-intelligence.calendar.event-upcoming')
    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.calendar.surfaces'])
  })

  it('falls back to the first item when the target cannot be located', async () => {
    await render('platform.something-else')
    expect(listItems()[0]?.getAttribute('aria-current')).toBe('true')
  })

  it('turns the list into a dropdown on a narrow window, with the name and the state in the option text', async () => {
    // 窄窗下换控件而不是压缩：列表 → 下拉；名字与状态都进选项文本（图标认不出是哪一条）。
    sectionWidth = 800
    await render()
    // 宽度是挂载后量出来的：再走一个渲染轮次，等布局切换落定。
    await act(async () => { await Promise.resolve() })
    expect(container?.querySelector('.intelligence-notification-list')).toBeNull()
    const select = container?.querySelector('select')
    expect(select).not.toBeNull()
    const options = [...(select?.querySelectorAll('option') ?? [])]
    expect(options).toHaveLength(4)
    expect(options[3]?.textContent).toContain(text['pages.intelligence.notification.rows.calendar.title'])
    expect(options[3]?.textContent).toContain(text['pages.intelligence.notification.status.off'])

    await act(async () => {
      if (select) { (select as HTMLSelectElement).value = 'calendar'; select.dispatchEvent(new Event('change', { bubbles: true })) }
      await Promise.resolve()
    })
    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.calendar.surfaces'])
  })

  it('keeps three columns at a 1000 container even though the window is wider', async () => {
    // 专抓「按窗口宽度判断」那个错：容器 1000 排得下三列（页面最小 860），不该切下拉。
    sectionWidth = 1000
    await render()
    await act(async () => { await Promise.resolve() })
    expect(container?.querySelector('.intelligence-notification-panes')).not.toBeNull()
    expect(container?.querySelector('.intelligence-notification-list')).not.toBeNull()
  })

  it('collapses the lead and importance controls while the reminder is off and says what would happen', async () => {
    await render()
    await selectItem(3)
    const detail = container?.querySelector('.intelligence-notification-calendar-detail')?.textContent ?? ''
    expect(detail).toContain(text['pages.intelligence.notification.calendar.summary'].replace('{lead}', '1 小时').replace('{importance}', '高'))
    // 关着靠收起：提前量与重要性整行都不出现（不画禁用控件）。
    expect(detail).not.toContain(text['pages.intelligence.notification.calendar.lead'])
    expect(detail).not.toContain(text['pages.intelligence.notification.calendar.importance'])
  })

  it('warns in place when a ticked surface has its master switch off, and never greys the checkbox', async () => {
    install({ getDeliverySettings: vi.fn(async () => ({ toastEnabled: false, desktopEnabled: false, pushWired: true, channels: [], lastPushFailureAt: null, lastPushFailureReason: null })) })
    await render()
    await selectItem(3)
    const toastBox = [...container!.querySelectorAll<HTMLInputElement>('.intelligence-notification-form-check input[type="checkbox"]')]
      .find((input) => input.closest('label')?.textContent?.includes(text['pages.intelligence.notification.surface.toast']!))
    expect(toastBox?.checked).toBe(true)
    expect(toastBox?.disabled).toBe(false)
    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.surfaceBlocked.toast'])
  })

  it('says so in place when a surface tick fails to save, instead of silently reverting', async () => {
    // 缺陷（用户 2026-11-07「通知方式这里不能改」）：写失败时页面一声不响、勾选回原样，
    // 读者看到的就是「点了没反应」。这条钉住「失败必须当场说」。
    install({ setSurfaceSelection: vi.fn(async () => { throw new Error('settings-write-failed') }) })
    await render()
    await selectItem(3)
    const firstBox = container!.querySelector<HTMLInputElement>('.intelligence-notification-form-check input[type="checkbox"]')!
    await act(async () => { firstBox.click(); await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.saveFailed'])
  })

  it('opens on the locked defaults: both notice types ticked, the reminder off, one hour, high only', async () => {
    // 用户 2026-11-07 锁定（产品已写进需求 v3.79 / 验收 v2.94）：这些数不再讨论。
    install({
      productsInvoke: vi.fn(async (_productId: string, method: string) => {
        if (String(method).includes('getCalendarReminderSettings')) return DEFAULT_CALENDAR_REMINDER_SETTINGS
        return { enabled: true }
      })
    })
    await render()
    await selectItem(3)
    // 通知方式：两个面都勾着（平台契约「缺省＝允许」）。
    const surfaceBoxes = [...container!.querySelectorAll<HTMLInputElement>('.intelligence-notification-form-check input[type="checkbox"]')]
    expect(surfaceBoxes).toHaveLength(2)
    expect(surfaceBoxes.every((box) => box.checked)).toBe(true)
    // 提前提醒：关。
    expect(container?.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
    // 关着时用一行摘要说清「打开后会怎样」，不是让两个控件看起来能用却不起作用。
    expect(container?.textContent ?? '').toContain(
      text['pages.intelligence.notification.calendar.summary']!.replace('{lead}', '1 小时').replace('{importance}', '高')
    )
    // 通知条件：默认只推出乎意料的。
    expect(pressedLabel(text['pages.intelligence.notification.calendar.landedRow']!))
      .toBe(text['pages.intelligence.notification.landed.surprise-only'])
  })

  it('opens the reminder on those same locked defaults: one hour, high only', async () => {
    install({
      productsInvoke: vi.fn(async (_productId: string, method: string) => {
        if (String(method).includes('getCalendarReminderSettings')) {
          return { ...DEFAULT_CALENDAR_REMINDER_SETTINGS, enabled: true }
        }
        return { enabled: true }
      })
    })
    await render()
    await selectItem(3)
    expect(pressedLabel(text['pages.intelligence.notification.calendar.lead']!))
      .toBe(text['pages.intelligence.notification.leads.60'])
    const importanceBoxes = [...(container?.querySelectorAll<HTMLInputElement>(
      `[role="group"][aria-label="${text['pages.intelligence.notification.calendar.importance']}"] input[type="checkbox"]`
    ) ?? [])]
    expect(importanceBoxes).toHaveLength(3)
    expect(importanceBoxes.map((box) => box.checked)).toEqual([true, false, false])
  })


  it('offers the intensity threshold under the sentiment item, defaulting to Medium', async () => {
    // 读者 2026-11-07：舆情推送要能设强度门槛（弱/中/强，选哪档就是该档以上）。默认「中」＝现状。
    await render()
    await selectItem(2)
    const body = container?.textContent ?? ''
    expect(body).toContain(text['pages.intelligence.notification.threshold.row'])
    const group = [...(container?.querySelectorAll('[role="group"]') ?? [])]
      .find((node) => node.getAttribute('aria-label') === text['pages.intelligence.notification.threshold.row'])
    expect(group).not.toBeUndefined()
    const labels = [...(group?.querySelectorAll('button') ?? [])].map((button) => button.textContent)
    // 顺序按界面设计签的「高 / 中 / 低」，与本页其他分级同向。
    expect(labels).toEqual([
      text['pages.intelligence.notification.threshold.high'],
      text['pages.intelligence.notification.threshold.medium'],
      text['pages.intelligence.notification.threshold.low']
    ])
    expect(group?.querySelector('[aria-pressed="true"]')?.textContent)
      .toBe(text['pages.intelligence.notification.threshold.medium'])
  })

  it('saves the chosen tier and shows what the service read back', async () => {
    const invoke = vi.fn(async (_productId: string, method: string, payload?: unknown) => {
      if (String(method).includes('saveNewsPushThreshold')) {
        return { pushThreshold: (payload as { pushThreshold?: string })?.pushThreshold }
      }
      if (String(method).includes('getNewsPushThreshold')) return { pushThreshold: 'medium' }
      return { enabled: true }
    })
    install({ productsInvoke: invoke })
    await render()
    await selectItem(2)
    const group = [...(container?.querySelectorAll('[role="group"]') ?? [])]
      .find((node) => node.getAttribute('aria-label') === text['pages.intelligence.notification.threshold.row'])!
    const strong = [...group.querySelectorAll('button')]
      .find((button) => button.textContent === text['pages.intelligence.notification.threshold.high'])!
    await act(async () => { strong.click(); await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'intelligence.saveNewsPushThreshold', { pushThreshold: 'high' })
    expect(group.querySelector('[aria-pressed="true"]')?.textContent)
      .toBe(text['pages.intelligence.notification.threshold.high'])
  })

  it('shows the cost line only once the lowest tier is chosen', async () => {
    // 界面设计 2026-11-07：代价只给量级（「几十条」），且**只在选「低」时出现**；不写实测数字，
    // 那会变成承诺，明天变多就是我们在撒谎。
    const invoke = vi.fn(async (_productId: string, method: string, payload?: unknown) => {
      if (String(method).includes('saveNewsPushThreshold')) return { pushThreshold: (payload as { pushThreshold?: string })?.pushThreshold }
      if (String(method).includes('getNewsPushThreshold')) return { pushThreshold: 'medium' }
      return { enabled: true }
    })
    install({ productsInvoke: invoke })
    await render()
    await selectItem(2)
    expect(container?.textContent ?? '').not.toContain(text['pages.intelligence.notification.threshold.cost'])

    const group = [...(container?.querySelectorAll('[role="group"]') ?? [])]
      .find((node) => node.getAttribute('aria-label') === text['pages.intelligence.notification.threshold.row'])!
    const low = [...group.querySelectorAll('button')]
      .find((button) => button.textContent === text['pages.intelligence.notification.threshold.low'])!
    await act(async () => { low.click(); await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.threshold.cost'])
  })

  it('says so when saving the tier fails, and keeps the value the service still reports', async () => {
    // 用户 2026-11-07「点了没反应」那类缺陷的防线：写失败必须当场说，而且界面跟着服务的值走，
    // 不许本地先翻过去再悄悄回滚。
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (String(method).includes('saveNewsPushThreshold')) throw new Error('write failed')
      if (String(method).includes('getNewsPushThreshold')) return { pushThreshold: 'medium' }
      return { enabled: true }
    })
    install({ productsInvoke: invoke })
    await render()
    await selectItem(2)
    const group = [...(container?.querySelectorAll('[role="group"]') ?? [])]
      .find((node) => node.getAttribute('aria-label') === text['pages.intelligence.notification.threshold.row'])!
    const strong = [...group.querySelectorAll('button')]
      .find((button) => button.textContent === text['pages.intelligence.notification.threshold.high'])!
    await act(async () => { strong.click(); await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.saveFailed'])
    expect(group.querySelector('[aria-pressed="true"]')?.textContent)
      .toBe(text['pages.intelligence.notification.threshold.medium'])
  })

  it('shows the cost line only when "also matched" is chosen', async () => {
    install({
      productsInvoke: vi.fn(async (_productId: string, method: string) => {
        if (String(method).includes('getCalendarReminderSettings')) {
          return { enabled: false, leadMinutes: 60, importance: ['high'], landedFilter: 'also-matched' }
        }
        return { enabled: false }
      })
    })
    await render()
    await selectItem(3)
    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.landed.cost'])
  })
})

/** 有可用通道：`channelReady` 由投影的 `deliverable` 决定。 */
const oneChannel = [{ id: 'slack', name: 'Slack', deliverable: true }]
const twoChannels = [
  { id: 'slack', name: 'Slack', deliverable: true },
  { id: 'telegram', name: 'Telegram', deliverable: true }
]

function testButtons(): HTMLButtonElement[] {
  return [...(container?.querySelectorAll<HTMLButtonElement>('[data-test-notification]') ?? [])]
}

async function clickTestButton(kind: string): Promise<void> {
  const button = container?.querySelector<HTMLButtonElement>(`[data-test-notification="${kind}"]`)
  if (!button) throw new Error(`Expected the ${kind} test button.`)
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

describe('通知配置后的测试按钮（R201）', () => {
  it('renders nothing at all when no channel can deliver — not a disabled button', async () => {
    install({ getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, pushWired: true, channels: [], lastPushFailureAt: null, lastPushFailureReason: null })) })
    await render()
    expect(testButtons()).toHaveLength(0)
    // 既有说明仍在：指路没有跟着按钮一起消失。
    expect(container?.textContent).toContain(text['pages.intelligence.notification.channelNotReady'])
  })

  it('renders one button per config item with a per-row label, and names the channel on success', async () => {
    const stubs = install({ getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, pushWired: true, channels: oneChannel, lastPushFailureAt: null, lastPushFailureReason: null })) })
    await render()

    // 舆情行 + 日历两行：三枚，各按行写「会发什么」。
    await selectItem(2)
    expect(container?.querySelector('[data-test-notification="sentiment"]')?.textContent).toContain(
      text['pages.intelligence.notification.test.sentiment']
    )
    await clickTestButton('sentiment')
    expect(stubs.sendTest).toHaveBeenCalledWith({ kind: 'sentiment' })
    expect(container?.textContent).toContain('已发到 Slack（测试）')
    // 成功句必须点名通道名，不能只写「已发送」。
    expect(container?.textContent).not.toContain('已发送')
  })

  it('keeps the button when two channels are enabled, then refuses with the count the main process reported', async () => {
    const stubs = install({
      getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, pushWired: true, channels: twoChannels, lastPushFailureAt: null, lastPushFailureReason: null })),
      sendTest: vi.fn(async () => ({ state: 'unavailable' as const, reasonCode: 'push-unavailable', enabledChannelCount: 2 }))
    })
    await render()

    // 两行各一枚：日历行打开时两枚都在（开始前 / 落地），按钮在不在只取决于「有没有可用通道」，
    // 不取决于「唯一不唯一」——两条通道时仍然渲染、可点。
    await selectItem(3)
    expect(testButtons().map((button) => button.dataset.testNotification).sort()).toEqual([
      'calendar-landed',
      'calendar-upcoming'
    ])
    // 舆情那一行走它自己那一枚。
    await selectItem(2)
    expect(testButtons()).toHaveLength(1)
    await clickTestButton('sentiment')

    expect(stubs.sendTest).toHaveBeenCalledWith({ kind: 'sentiment' })
    const text_ = container?.textContent ?? ''
    expect(text_).toContain('你启用了 2 条通道')
    // 原因码只在折叠区：主句 0 次，展开后恰好 1 处。
    const sentence = container?.querySelector('[data-test-result="failed"]')?.textContent ?? ''
    expect(sentence).not.toContain('push-unavailable')
    expect(text_.split('push-unavailable')).toHaveLength(2)
  })

  it('disables the button while sending, so a second click cannot produce a second message', async () => {
    let release: (value: unknown) => void = () => undefined
    const stubs = install({
      getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, pushWired: true, channels: oneChannel, lastPushFailureAt: null, lastPushFailureReason: null })),
      sendTest: vi.fn(() => new Promise((resolve) => { release = resolve }))
    })
    await render()
    await selectItem(2)

    const button = container?.querySelector<HTMLButtonElement>('[data-test-notification="sentiment"]')
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    expect(button?.disabled).toBe(true)
    expect(button?.textContent).toContain(text['pages.intelligence.notification.test.sending'])
    // 真禁用：再点一次不会再发。
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    expect(stubs.sendTest).toHaveBeenCalledTimes(1)
    await act(async () => {
      release({ state: 'sent', channelId: 'slack', channelName: 'Slack' })
      await Promise.resolve()
    })
    expect(button?.disabled).toBe(false)
  })

  it('says the per-row 「nothing to send」 sentence and never shows a reason code', async () => {
    install({
      getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, pushWired: true, channels: oneChannel, lastPushFailureAt: null, lastPushFailureReason: null })),
      sendTest: vi.fn(async () => ({ state: 'no-data' as const, reasonCode: 'sentiment-none' }))
    })
    await render()
    await selectItem(2)
    await clickTestButton('sentiment')

    expect(container?.textContent).toContain('最近 7 天没有符合条件的舆情')
    expect(container?.textContent).not.toContain('sentiment-none')
    expect(container?.querySelector('details')).toBeNull()
  })

  it('puts the failure reason code only in the collapsed area, never in the sentence', async () => {
    install({
      getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, pushWired: true, channels: oneChannel, lastPushFailureAt: null, lastPushFailureReason: null })),
      sendTest: vi.fn(async () => ({ state: 'unavailable' as const, reasonCode: 'timezone-unreadable' }))
    })
    await render()
    await selectItem(2)
    await clickTestButton('sentiment')

    const sentence = container?.querySelector('[data-test-result="failed"]')?.textContent ?? ''
    expect(sentence).toContain('测试消息没发出去')
    expect(sentence).not.toContain('timezone-unreadable')
    const details = container?.querySelector('details')
    expect(details?.open).toBe(false)
    expect(details?.textContent).toContain('timezone-unreadable')
  })

  it('disables the button and says why when that config item is off', async () => {
    install({
      getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, pushWired: true, channels: oneChannel, lastPushFailureAt: null, lastPushFailureReason: null })),
      getChannelEvents: vi.fn(async () => ({})),
      productsInvoke: vi.fn(async (_productId: string, method: string) => {
        if (String(method).includes('getNewsPushThreshold') || String(method).includes('saveNewsPushThreshold')) return { pushThreshold: 'medium' }
        if (String(method).includes('getNewsPushOutletState')) return { enabled: false }
        if (String(method).includes('getCalendarReminderSettings')) return { enabled: false, leadMinutes: 60, importance: ['high'], landedFilter: 'surprise-only' }
        return { enabled: false }
      })
    })
    await render()
    await selectItem(2)
    const button = container?.querySelector<HTMLButtonElement>('[data-test-notification="sentiment"]')
    expect(button?.disabled).toBe(true)
    expect(container?.textContent).toContain(text['pages.intelligence.notification.test.needEnabled'])
  })
})

describe('不动任何配置项（判据 ⑥）', () => {
  it('keeps every config row where it was: same labels, same order, one control each', async () => {
    install({ getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, pushWired: true, channels: oneChannel, lastPushFailureAt: null, lastPushFailureReason: null })) })
    await render()

    const signature = (): string[] => [...(container?.querySelectorAll('.intelligence-notification-form-row') ?? [])]
      .map((row) => {
        const label = row.querySelector('.intelligence-notification-form-label')?.textContent ?? ''
        const control = row.querySelector('.intelligence-notification-form-control')
        // 测试动作组不算「配置控件」：它必须与原有控件并列，而不是替代或挪动它们。
        const controls = [...(control?.children ?? [])]
          .filter((child) => !child.classList.contains('intelligence-notification-test-action'))
          .map((child) => child.tagName.toLowerCase())
        return `${label}:${controls.join('+')}`
      })

    await selectItem(2)
    expect(signature()).toEqual(['舆情提醒:button', '最低强度:div+span'])

    await selectItem(3)
    expect(signature()).toEqual(['通知方式:div', '提前提醒:button+span', '通知条件:div'])
  })
})

describe('超时（10 秒）', () => {
  it('turns a send that never resolves into the failure sentence, without inventing a reason code', async () => {
    vi.useFakeTimers()
    try {
      install({
        getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, pushWired: true, channels: oneChannel, lastPushFailureAt: null, lastPushFailureReason: null })),
        sendTest: vi.fn(() => new Promise(() => undefined))
      })
      await render()
      await selectItem(2)
      const button = container?.querySelector<HTMLButtonElement>('[data-test-notification="sentiment"]')
      await act(async () => {
        button?.click()
        await Promise.resolve()
      })
      expect(button?.disabled).toBe(true)
      await act(async () => {
        vi.advanceTimersByTime(10_000)
        await Promise.resolve()
      })
      expect(container?.querySelector('[data-test-result="failed"]')?.textContent).toContain(
        text['pages.intelligence.notification.test.failed']
      )
      // 超时不是主进程给的结论，所以**不编一个码**：折叠区不出现。
      expect(container?.querySelector('details')).toBeNull()
      expect(button?.disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ⓘ 是按钮，说明挂在 aria-describedby 上（界面 2026-11-08 规则）', () => {
  it('is a button named 「发送测试说明」, opens on focus, describes itself, and Esc returns focus', async () => {
    install({ getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, pushWired: true, channels: oneChannel, lastPushFailureAt: null, lastPushFailureReason: null })) })
    await render()
    await selectItem(2)

    const control = container?.querySelector('[data-test-notification="sentiment"]')?.parentElement
    const trigger = [...(control?.querySelectorAll('button') ?? [])]
      .find((button) => button.getAttribute('aria-label') === text['pages.intelligence.notification.test.infoAria'])
    expect(trigger, 'ⓘ 必须是一颗按钮，名字逐字是「发送测试说明」').toBeDefined()
    expect(trigger?.tagName).toBe('BUTTON')

    // 聚焦即展开：aria-expanded 变真，说明以 aria-describedby 挂在这个触发件上。
    await act(async () => {
      trigger?.focus()
      trigger?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      await Promise.resolve()
    })
    expect(trigger?.getAttribute('aria-expanded')).toBe('true')
    // 说明本身在浮层里；`aria-describedby` 这一半等 Popover 组件支持（见提交说明的「缺口」一段）。
    expect(document.querySelector('[data-popover-line="0"]')?.textContent).toBe(
      text['pages.intelligence.notification.test.info']
    )

    // Esc 收起并把焦点还回触发件。
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await Promise.resolve()
    })
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    expect(trigger?.getAttribute('aria-label')).not.toContain('更多')
  })
})
