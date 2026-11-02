// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'

import { formatUnreadBadge, NotificationBell, UNREAD_BADGE_CAP } from './NotificationBell'
import type { NotificationCenterSource } from './notificationCenterSource'

const labels = platformText['zh-CN'].notifications

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

/** 只做铃铛用到的那几件事；其余方法给抛错桩，免得将来偷偷用它还没被测过。 */
function fakeSource(options: {
  unread: () => Promise<{ unread: number; version: number }>
  onChanged?: (callback: (change: { version: number }) => void) => () => void
}): NotificationCenterSource {
  return {
    list: () => Promise.reject(new Error('bell must not list')),
    unread: options.unread,
    markAllRead: () => Promise.reject(new Error('bell must not mark')),
    deleteRead: () => Promise.reject(new Error('bell must not delete')),
    markRead: () => Promise.reject(new Error('bell must not mark one')),
    onChanged: (callback) => (options.onChanged ? options.onChanged(callback) : () => undefined)
  }
}

async function mount(source: NotificationCenterSource): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<NotificationBell labels={labels} onOpen={() => undefined} source={source} />)
  })
  // 读数是异步的：再 flush 一次，让 `.then` 落进 state。
  await act(async () => {
    await Promise.resolve()
  })
  return host
}

function badgeText(): string | null {
  return document.body.querySelector('[data-unread-badge]')?.textContent ?? null
}

function bellName(): string | null {
  return document.body.querySelector('[data-notification-bell] button')?.getAttribute('aria-label') ?? null
}

describe('铃铛角标的三条口径', () => {
  it('0 条未读不渲染角标，读屏名里也不出现数字', async () => {
    await mount(fakeSource({ unread: async () => ({ unread: 0, version: 0 }) }))

    expect(badgeText()).toBeNull()
    expect(bellName()).toBe(labels.bell)
  })

  it('有未读时角标是数字，读屏名是整句', async () => {
    await mount(fakeSource({ unread: async () => ({ unread: 7, version: 0 }) }))

    expect(badgeText()).toBe('7')
    expect(bellName()).toBe(labels.bellUnread('7'))
  })

  it('超过上限显示 99+，不是把三位数挤进角标', () => {
    expect(UNREAD_BADGE_CAP).toBe(99)
    expect(formatUnreadBadge(100)).toBe('99+')
    expect(formatUnreadBadge(99)).toBe('99')
    expect(formatUnreadBadge(0)).toBeNull()
    expect(formatUnreadBadge(-3)).toBeNull()
    expect(formatUnreadBadge(Number.NaN)).toBeNull()
  })
})

describe('铃铛的第一次读数', () => {
  it('首次就读不到时不出角标、也不崩', async () => {
    // 桥还没就绪时更常见的是第一次读数失败：不该把失败变成「0 条未读」，也不该抛出去。
    await mount(fakeSource({ unread: async () => Promise.reject(new Error('bridge not ready')) }))

    expect(badgeText()).toBeNull()
    expect(bellName()).toBe(labels.bell)
  })
})

describe('铃铛跟着事件走，不靠重新挂载', () => {
  it('抽屉关着时收到变化事件，角标重读并跟着变', async () => {
    let emit: ((change: { version: number }) => void) | undefined
    let current = 1
    const source = fakeSource({
      unread: async () => ({ unread: current, version: current }),
      onChanged: (callback) => {
        emit = callback
        return () => undefined
      }
    })

    await mount(source)
    expect(badgeText()).toBe('1')

    current = 4
    await act(async () => {
      emit?.({ version: 2 })
      await Promise.resolve()
    })

    expect(badgeText()).toBe('4')
  })

  it('读不到时保持上一次的数字，不倒成 0', async () => {
    // 把「读失败」当成「没有未读」是在撒谎：角标清零比留着旧数更误导。
    let call = 0
    let emit: ((change: { version: number }) => void) | undefined
    const source = fakeSource({
      unread: async () => {
        call += 1
        if (call > 1) throw new Error('bridge gone')
        return { unread: 5, version: 1 }
      },
      onChanged: (callback) => {
        emit = callback
        return () => undefined
      }
    })

    await mount(source)
    expect(badgeText()).toBe('5')

    await act(async () => {
      emit?.({ version: 2 })
      await Promise.resolve()
    })

    expect(badgeText()).toBe('5')
  })
})
