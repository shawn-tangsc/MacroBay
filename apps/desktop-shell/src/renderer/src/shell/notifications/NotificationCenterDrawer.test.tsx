// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotificationCenterItem, NotificationUnreadState } from '@platform/notifications/contracts/notificationContracts'

import { platformText } from '../../i18n/platformText'

import { NOTIFICATION_CENTER_PANEL_ID, NotificationCenterDrawer } from './NotificationCenterDrawer'
import type { NotificationCenterSource } from './notificationCenterSource'

const labels = platformText['zh-CN'].notifications

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

/**
 * 渲染层拿到的那一份：**句子里已经解析好**，没有 `titleKey`、没有参数表。
 * 工厂照这个形状造，捏不出一个「带键的记录」——这正是这条约束想要的效果。
 */
function record(overrides: Partial<NotificationCenterItem> & { id: string }): NotificationCenterItem {
  return {
    owner: 'platform',
    sourceId: 'platform.test',
    title: `任务失败：${overrides.id}`,
    body: '',
    severity: 'warning',
    priority: 'normal',
    channels: ['center'],
    state: 'unread',
    actions: [],
    occurrenceCount: 1,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...overrides
  } as NotificationCenterItem
}

const deeplink = { scope: 'platform' as const, entityType: 'job', entityId: 'job-1' }

function fakeSource(overrides: Partial<NotificationCenterSource> = {}): NotificationCenterSource {
  const read: NotificationUnreadState = { unread: 0, version: 1 }
  return {
    list: async () => ({ items: [] }),
    unread: async () => read,
    markAllRead: async () => read,
    deleteRead: async () => ({ deleted: 0 }),
    markRead: async (id: string) => record({ id, state: 'read' }),
    onChanged: () => () => undefined,
    ...overrides
  }
}

async function mount(
  source: NotificationCenterSource,
  onOpenDeeplink: (d: unknown) => void = () => undefined,
  language: 'zh-CN' | 'en-US' = 'zh-CN'
): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <NotificationCenterDrawer
        open
        onClose={() => undefined}
        labels={platformText[language].notifications}
        onOpenDeeplink={onOpenDeeplink}
        source={source}
      />
    )
  })
  // 首帧是 loading，list 的兑现要再 flush 一次。
  await act(async () => {
    await Promise.resolve()
  })
}

function buttons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll<HTMLButtonElement>('.notification-center-footer button')]
}

/** antd 会在两个汉字之间插一个空格（「取消」渲染成「取 消」），比对前先抹掉空白。 */
const flat = (value: string | null): string => (value ?? '').replace(/\s+/g, '')

function footerButton(label: string): HTMLButtonElement {
  const found = buttons().find((button) => flat(button.textContent) === flat(label))
  if (!found) throw new Error(`no footer button ${label}; have ${buttons().map((b) => flat(b.textContent)).join(' | ')}`)
  return found
}

function rows(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('.notification-center-row')]
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

describe('通知中心的分组与空态', () => {
  it('没有记录时给空态，不渲染任何分组', async () => {
    await mount(fakeSource())

    expect(document.body.querySelector('.state-view')).not.toBeNull()
    expect(document.body.querySelector('[data-state-icon="empty"]')).not.toBeNull()
    expect(rows()).toHaveLength(0)
  })

  it('空态下面补一句本页专属的说明：通用句说不出等的是谁', async () => {
    await mount(fakeSource())

    // 界面设计退回项：通用 `not-yet` 只说「还没到」，说不出这个页面等的是什么事件。
    const hint = document.body.querySelector('.notification-center-empty-hint')
    expect(hint?.textContent).toBe(labels.centerEmptyHint)
    // 铃铛的 `aria-controls` 指向这个 id：打开时它必须真的存在（指向空处比不写更糟）。
    expect(document.getElementById(NOTIFICATION_CENTER_PANEL_ID)).not.toBeNull()
    // 说明必须挂在 `StateView` 之外：改平台键会让另外七处 `not-yet` 说别人的话。
    expect(hint?.closest('.state-view')).toBeNull()
  })

  it('未读在上、已读在下；没有目标的通知只进「仅记录」组且没有动作', async () => {
    const source = fakeSource({
      list: async () => ({
        items: [
          record({ id: 'read-1', state: 'read', deeplink }),
          record({ id: 'unread-1', deeplink }),
          record({ id: 'no-target-1' })
        ]
      })
    })
    await mount(source)

    const groups = [...document.body.querySelectorAll<HTMLElement>('.notification-center-group')]
    expect(groups.map((group) => group.querySelector('.notification-center-group-title')?.textContent)).toEqual([
      labels.centerUnreadGroup,
      labels.centerEarlierGroup,
      labels.centerRecordedGroup
    ])

    // 仅记录组里没有动作控件：没有目标可去，行上就不该出现按钮。
    const recorded = groups.at(-1)!
    expect(recorded.querySelectorAll('button')).toHaveLength(0)
    expect(rows().map((row) => row.getAttribute('data-state'))).toEqual(['unread', 'read', 'unread'])
  })

  it('列表读不到时给错误态，重试会再读一次', async () => {
    let attempts = 0
    const source = fakeSource({
      list: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('bridge gone')
        return { items: [record({ id: 'after-retry', deeplink })] }
      }
    })
    await mount(source)

    expect(document.body.querySelector('[data-state-icon="error"]')).not.toBeNull()

    const retry = document.body.querySelector<HTMLButtonElement>('.state-view button')
    expect(retry).not.toBeNull()
    await click(retry!)

    expect(attempts).toBe(2)
    expect(rows()).toHaveLength(1)
  })

  it('回了个不是列表的东西时说「原因没查清」，不说「没有通知」', async () => {
    // 既没成功、也没给出可判定的错误：这既不是空，也不该承诺「重试就好」。
    const source = fakeSource({ list: async () => ({ nope: true }) as never })
    await mount(source)

    const view = document.body.querySelector('[data-state="error"]')
    expect(view).not.toBeNull()
    // 两态靠原因码与原因句区分，标题共用「读取失败」是允许的。
    expect(document.body.textContent).toContain('这不代表没有通知')
    expect(document.body.textContent).not.toContain('没有需要你处理的事')
    // 批量动作这时禁用，原因写在面板里一次。
    expect(document.body.querySelector('[data-center-unknown-hint]')).not.toBeNull()
  })

  it('读取失败与原因不明用两个原因码，句子也不同', async () => {
    const failing = fakeSource({ list: async () => Promise.reject(new Error('bridge gone')) })
    await mount(failing)
    const failureText = document.body.textContent

    document.body.innerHTML = ''
    const unknown = fakeSource({ list: async () => ({ nope: true }) as never })
    await mount(unknown)
    const unknownText = document.body.textContent

    // 同一句就说明两个态没分开。
    expect(failureText).not.toBe(unknownText)
    expect(unknownText).toContain('这不代表没有通知')
  })
})

describe('清空与删除是两件事', () => {
  it('清空 = 全部标为已读：条数一条不减', async () => {
    let markAllCalls = 0
    const source = fakeSource({
      list: async () => ({ items: [record({ id: 'a', deeplink }), record({ id: 'b', deeplink })] }),
      markAllRead: async () => {
        markAllCalls += 1
        return { unread: 0, version: 2 }
      }
    })
    await mount(source)

    expect(rows()).toHaveLength(2)
    await click(footerButton(labels.centerMarkAllRead))

    expect(markAllCalls).toBe(1)
    // 条数不变，只是状态变了。
    expect(rows()).toHaveLength(2)
    expect(rows().map((row) => row.getAttribute('data-state'))).toEqual(['read', 'read'])
    expect(document.body.textContent).toContain(labels.centerReadDone)
    // 全已读后这个动作没有对象，按钮要禁用而不是点了没反应。
    expect(footerButton(labels.centerMarkAllRead).disabled).toBe(true)
  })

  it('删除已读要二次确认，且只删已读', async () => {
    let deletes = 0
    const source = fakeSource({
      list: async () => ({ items: [record({ id: 'unread-1', deeplink }), record({ id: 'read-1', state: 'read', deeplink })] }),
      deleteRead: async () => {
        deletes += 1
        return { deleted: 1 }
      }
    })
    await mount(source)

    // 第一次点击只进确认态：没有任何删除发生。
    await click(footerButton(labels.centerDeleteRead))
    expect(deletes).toBe(0)
    expect(document.body.textContent).toContain(labels.centerDeleteReadConfirm)
    expect(rows()).toHaveLength(2)

    await click(footerButton(labels.centerDeleteRead))

    expect(deletes).toBe(1)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]?.getAttribute('data-state')).toBe('unread')
    expect(document.body.textContent).toContain(labels.centerDeleteReadDone('1'))
  })

  it('取消失去确认态，什么都不删', async () => {
    let deletes = 0
    const source = fakeSource({
      list: async () => ({ items: [record({ id: 'read-1', state: 'read', deeplink })] }),
      deleteRead: async () => {
        deletes += 1
        return { deleted: 1 }
      }
    })
    await mount(source)

    await click(footerButton(labels.centerDeleteRead))
    await click(footerButton(labels.centerCancel))

    expect(deletes).toBe(0)
    expect(document.body.textContent).not.toContain(labels.centerDeleteReadConfirm)
    expect(rows()).toHaveLength(1)
  })
})

describe('句子由主进程解析，渲染层只负责画', () => {
  it('画的就是载荷里那两句：这里没有表可查，也没有参数要填', async () => {
    const source = fakeSource({
      list: async () => ({
        items: [
          record({ id: 'zh', deeplink, title: '任务失败：央行', body: '这一次没有跑完。' })
        ]
      })
    })
    await mount(source)

    expect(document.body.textContent).toContain('任务失败：央行')
    expect(document.body.textContent).toContain('这一次没有跑完。')
  })

  it('解析失败时界面上只有那一句兜底句，不留 {taskName}（N24①）', async () => {
    const source = fakeSource({
      list: async () => ({
        items: [
          record({ id: 'degraded', deeplink, title: '有一条新通知', body: '' })
        ]
      })
    })
    await mount(source)

    expect(document.body.textContent).toContain('有一条新通知')
    // 占位符原样打出来与露键同罪：读者看到 `{taskName}` 就是在看我们的内部形状。
    expect(document.body.textContent).not.toContain('{')
  })

  it('主位行的动作是通知自己要做的事，点击真的把 deeplink 交出去', async () => {
    const opened: unknown[] = []
    const source = fakeSource({
      list: async () => ({
        items: [
          record({
            id: 't1',
            deeplink,
            actions: [{ id: 'open-task', label: '打开任务', kind: 'open', deeplink }]
          })
        ]
      })
    })
    await mount(source, (value) => opened.push(value))

    const action = [...document.body.querySelectorAll<HTMLButtonElement>('.notification-center-row button')]
      .find((button) => flat(button.textContent) === '打开任务')
    expect(action).toBeTruthy()

    await act(async () => {
      action!.click()
    })
    // 断言 deeplink 被消费，而不是「按钮存在」：存在但点了没用的按钮正是这条要修的。
    expect(opened).toEqual([deeplink])
  })

  it('行上不再拿「标为已读」冒充通知动作', async () => {
    const source = fakeSource({
      list: async () => ({
        items: [
          record({
            id: 't2',
            deeplink,
            actions: [{ id: 'open-task', label: '打开任务', kind: 'open', deeplink }]
          })
        ]
      })
    })
    await mount(source)
    const rowButtons = [...document.body.querySelectorAll<HTMLButtonElement>('.notification-center-row button')]
    expect(rowButtons.some((button) => flat(button.textContent) === flat(labels.centerMarkRead))).toBe(false)
  })

  it('点击动作同时把这条标已读，角标才有得减', async () => {
    const markRead = vi.fn(async (id: string) => record({ id, state: 'read' }))
    const source = fakeSource({
      markRead,
      list: async () => ({
        items: [
          record({
            id: 't3',
            deeplink,
            actions: [{ id: 'open-task', label: '打开任务', kind: 'open', deeplink }]
          })
        ]
      })
    })
    await mount(source, () => undefined)

    const action = [...document.body.querySelectorAll<HTMLButtonElement>('.notification-center-row button')]
      .find((button) => flat(button.textContent) === '打开任务')
    await act(async () => {
      action!.click()
    })
    await act(async () => { await Promise.resolve() })

    // 一次操作两个效果：既跳转，也标读；只跳不标会留下一条永远不消的未读。
    expect(markRead).toHaveBeenCalledWith('t3')
  })
})

describe('首次进入不闪错误或空态', () => {
  it('读数还没回来时只画加载中：既不画错误，也不画「没有」', async () => {
    let resolveList: ((page: { items: NotificationCenterItem[] }) => void) | undefined
    const source = fakeSource({
      list: () =>
        new Promise((resolve) => {
          resolveList = resolve
        })
    })

    await mount(source)

    // 这一帧数据还没回来。旧行为是 `state === 'error'` 的分支排在最前，读取慢一点就先闪一下错误。
    expect(document.body.querySelector('.loading-state')).not.toBeNull()
    expect(document.body.querySelector('[data-state="error"]')).toBeNull()
    expect(document.body.querySelector('[data-state="empty"]')).toBeNull()

    await act(async () => {
      resolveList?.({ items: [record({ id: 'after-load', deeplink })] })
      await Promise.resolve()
    })

    expect(rows()).toHaveLength(1)
    expect(document.body.querySelector('[data-state="error"]')).toBeNull()
  })

  it('首次就读不到才出错误 + 重试；那不是「没有」', async () => {
    await mount(fakeSource({ list: async () => Promise.reject(new Error('bridge down')) }))

    expect(document.body.querySelector('[data-state="error"]')).not.toBeNull()
    expect(document.body.querySelector('[data-state="empty"]')).toBeNull()
    expect(document.body.querySelector('.state-view button')).not.toBeNull()
  })

  it('刷新失败时保留上一次的列表，并标「这是上次的读数」', async () => {
    let calls = 0
    const source = fakeSource({
      list: async () => {
        calls += 1
        if (calls === 1) return { items: [record({ id: 'kept', deeplink })] }
        throw new Error('refresh failed')
      }
    })

    await mount(source)
    expect(rows()).toHaveLength(1)

    // 关掉再打开 = 抽屉的重新读取入口；这一次读失败，但手上有上一次的列表。
    const render = (open: boolean): React.ReactElement =>
      createElement(NotificationCenterDrawer, {
        open,
        onClose: () => undefined,
        labels,
        onOpenDeeplink: () => undefined,
        source
      })
    await act(async () => {
      root!.render(render(false))
      await Promise.resolve()
    })
    await act(async () => {
      root!.render(render(true))
      await Promise.resolve()
    })

    expect(rows()).toHaveLength(1)
    const stale = document.body.querySelector('[data-center-stale]')
    expect(stale?.textContent).toContain(labels.centerStaleNotice)
    // 「重试」是把刚失败的操作再做一次；这个按钮只是重新读一遍列表，名字必须说对。
    expect(stale?.querySelector('button')?.textContent).toBe(labels.centerReload)
    expect(stale?.textContent).not.toContain('重试')
    // 有旧数据时不许整块换成页面级错误。
    expect(document.body.querySelector('[data-state="error"]')).toBeNull()
  })
})

describe('长正文的展开/收起', () => {
  it('tells assistive tech whether the body is open, and flips it on click', async () => {
    // 用英文那句（超过 90 字）触发收起形态：中文正文都太短，测不出这个分支。
    const english = platformText['en-US'].notifications
    const source = fakeSource({
      list: async () => ({
        items: [record({
          id: 'n-long',
          body: 'If you can read this line, the notification pipeline is wired end to end, and this sentence is long enough to be clamped before the reader expands it.'
        })]
      })
    })
    await mount(source, () => undefined, 'en-US')

    const toggle = document.body.querySelector<HTMLButtonElement>('.notification-center-link')
    expect(toggle).not.toBeNull()
    // 收起时读屏要听到「收起状态」，并且按钮说的是「展开」。
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.textContent).toBe(english.centerExpand)

    await act(async () => {
      toggle!.click()
      await Promise.resolve()
    })

    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(toggle?.textContent).toBe(english.centerCollapse)
  })

})
