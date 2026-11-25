// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotificationCenterItem } from '@platform/notifications/contracts/notificationCenterContracts'
import type { NotificationPosterEvidence } from '@platform/notifications/contracts/notificationPosterContracts'

import { platformText } from '../../i18n/platformText'

import { NotificationCenterDrawer, detailEntryId } from './NotificationCenterDrawer'
import { rowTitleId } from './notificationActionButton'
import type { NotificationCenterSource } from './notificationCenterSource'

const labels = platformText['zh-CN'].notifications

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function poster(patch: Partial<NotificationPosterEvidence> = {}): NotificationPosterEvidence {
  return {
    edition: { status: 'ready', contentHash: 'hash-1', failureCode: null, reasonKind: null },
    enabledImageChannelCount: 2,
    unsupportedImageChannelCount: 0,
    channels: [
      { channelId: 'a', channelName: 'A', supportsImage: true, state: 'sent-accepted', reasonKind: null, at: '2026-11-25T00:00:00.000Z' },
      { channelId: 'b', channelName: 'B', supportsImage: true, state: 'sent-accepted', reasonKind: null, at: '2026-11-25T00:00:00.000Z' }
    ],
    ...patch
  }
}

function item(id: string, patch: Partial<NotificationCenterItem> = {}): NotificationCenterItem {
  return {
    id,
    owner: 'product',
    productId: 'market-intelligence',
    sourceId: 'market-intelligence.daily-briefing',
    title: `日报已完成 ${id}`,
    body: '2026-11-24 08:31 中文版这一期已经生成。',
    severity: 'info',
    priority: 'normal',
    channels: ['center'],
    state: 'unread',
    actions: [],
    occurrenceCount: 1,
    createdAt: '2026-11-24T00:31:00.000Z',
    updatedAt: '2026-11-24T00:31:00.000Z',
    delivery: { push: { state: 'sent-accepted', at: '2026-11-24T00:31:00.000Z', channels: [] } },
    ...patch
  } as NotificationCenterItem
}

function source(items: readonly NotificationCenterItem[]): NotificationCenterSource {
  const unread = { unread: items.filter((entry) => entry.state === 'unread').length, version: 1 }
  return {
    list: async () => ({ items: [...items] }),
    unread: async () => unread,
    markAllRead: async () => unread,
    deleteRead: async () => ({ deleted: 0 }),
    markRead: async (id: string) => item(id, { state: 'read' }),
    onChanged: () => () => undefined
  }
}

async function mount(items: readonly NotificationCenterItem[], onClose = (): void => undefined): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <NotificationCenterDrawer
        open
        onClose={onClose}
        labels={labels}
        onOpenDeeplink={() => undefined}
        onOpenExternal={async () => undefined}
        source={source(items)}
      />
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
}

const flat = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, '')

function entryButton(id: string): HTMLButtonElement | null {
  return document.getElementById(detailEntryId(id)) as HTMLButtonElement | null
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

/** rc-drawer 在面板上听 `keydown` 并读 `keyCode`；happy-dom 不替我们填这个旧字段。 */
async function escape(): Promise<void> {
  const panel = document.querySelector('.ant-drawer-content')
  expect(panel).not.toBeNull()
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  Object.defineProperty(event, 'keyCode', { value: 27 })
  await act(async () => {
    panel!.dispatchEvent(event)
    await Promise.resolve()
  })
}

describe('详情入口（#46 ②）', () => {
  it('offers 详情 only on rows that really have detail content, described by the row title', async () => {
    await mount([
      item('with-poster', { poster: poster() }),
      item('without-poster')
    ])

    const entry = entryButton('with-poster')
    expect(flat(entry?.textContent)).toBe(flat(labels.detail.entry))
    // 一屏多颗「详情」时读屏要分得清：名字补上这一条的标题。
    expect(entry?.getAttribute('aria-describedby')).toBe(rowTitleId('with-poster'))
    expect(entryButton('without-poster')).toBeNull()
    // 行容器仍不可点，既有动作按钮一个字不动（这里那条记录没有动作，所以一行只有一颗「详情」）。
    expect(document.querySelector('.notification-center-row')?.getAttribute('role')).toBeNull()
  })
})

describe('详情视图（#46 ①）', () => {
  it('opens in the same drawer: the title becomes the record title and the delivery group shows both rows', async () => {
    await mount([item('with-poster', { poster: poster() })])

    await click(entryButton('with-poster')!)

    const detail = document.querySelector('[data-notification-detail]')
    expect(detail).not.toBeNull()
    // 标题换成这一条通知的标题（数据），不是抽屉自己的「通知」。
    expect(flat(document.querySelector('.drawer__title')?.textContent)).toBe('日报已完成with-poster')
    expect(flat(document.querySelector('.notification-detail__group')?.textContent)).toBe(flat(labels.detail.group))
    const rows = [...document.querySelectorAll('.notification-delivery-row')]
    expect(rows).toHaveLength(2)
    // 「文字」在前、「海报」紧随其后（同一次推送的两条消息必须挨着）。
    expect(flat(rows[0]?.querySelector('dt')?.textContent)).toBe(flat(labels.detail.text))
    expect(flat(rows[1]?.querySelector('dt')?.textContent)).toBe(flat(labels.detail.poster.label))
    expect(flat(rows[1]?.querySelector('.status-pill')?.textContent)).toBe(flat(labels.detail.state.sent))
    // 列表级的批量动作在详情里不出现。
    expect(document.querySelector('.notification-center-footer')).toBeNull()
  })

  it('moves focus to the back control when the detail opens', async () => {
    // 列表那一行连同「详情」按钮已被换掉：不主动落点，焦点会掉回 body，读屏读者不知道换屏了。
    await mount([item('with-poster', { poster: poster() })])
    await click(entryButton('with-poster')!)
    const back = document.querySelector<HTMLButtonElement>('[data-notification-detail] button[aria-label]')
    expect(back?.getAttribute('aria-label')).toBe(labels.detail.back)
    expect(document.activeElement).toBe(back)
  })

  it('goes back to the list on Escape and returns focus to the entry', async () => {
    await mount([item('with-poster', { poster: poster() })])
    const entry = entryButton('with-poster')!
    await click(entry)
    expect(document.querySelector('[data-notification-detail]')).not.toBeNull()

    await escape()

    expect(document.querySelector('[data-notification-detail]')).toBeNull()
    expect(document.querySelectorAll('.notification-center-row').length).toBe(1)
    // 焦点回入口：不然键盘读者回列表后掉到 body 上，丢了位置。
    expect(document.activeElement).toBe(entryButton('with-poster'))
  })

  it('still closes the whole drawer on Escape from the list', async () => {
    const onClose = vi.fn()
    await mount([item('with-poster', { poster: poster() })], onClose)

    await escape()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the deliverable rows honest: a record without poster evidence shows the text row alone', async () => {
    await mount([item('with-poster', { poster: poster({ edition: null, channels: [] }) })])

    await click(entryButton('with-poster')!)

    const rows = [...document.querySelectorAll('.notification-delivery-row')]
    expect(rows).toHaveLength(2)
    // edition 为 null 且一条图片通道都没试过：这一版没有图，不是失败。
    expect(flat(rows[1]?.querySelector('.status-pill')?.textContent)).toBe(flat(labels.detail.poster.state.noImage))
  })
})
