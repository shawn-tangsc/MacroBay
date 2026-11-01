// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { NotificationUnreadState, SafeNotificationRecord } from '@platform/notifications/contracts/notificationContracts'

import { platformText } from '../../i18n/platformText'

import { NotificationCenterDrawer } from './NotificationCenterDrawer'
import type { NotificationCenterSource } from './notificationCenterSource'

const labels = platformText['zh-CN'].notifications

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function record(overrides: Partial<SafeNotificationRecord> & { id: string }): SafeNotificationRecord {
  return {
    owner: 'platform',
    sourceId: 'platform.test',
    titleKey: 'notification.taskFailed.title',
    titleParams: { taskName: overrides.id },
    severity: 'warning',
    priority: 'normal',
    channels: ['center'],
    state: 'unread',
    actions: [],
    occurrenceCount: 1,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...overrides
  } as SafeNotificationRecord
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

async function mount(source: NotificationCenterSource): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <NotificationCenterDrawer open onClose={() => undefined} labels={labels} language="zh-CN" source={source} />
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

describe('记录里存的是键，句子在展示时解析', () => {
  it('句子按当前语言解析，缺的参数原样留下', async () => {
    const source = fakeSource({
      list: async () => ({
        items: [
          record({ id: 'zh', deeplink, titleParams: { taskName: '央行' } }),
          record({ id: 'missing-param', deeplink, titleParams: {} })
        ]
      })
    })
    await mount(source)

    expect(document.body.textContent).toContain('央行')
    // 缺参不许静默消失：`{taskName}` 留在句子里，看得见才会被修。
    expect(document.body.textContent).toContain('{taskName}')
  })
})
