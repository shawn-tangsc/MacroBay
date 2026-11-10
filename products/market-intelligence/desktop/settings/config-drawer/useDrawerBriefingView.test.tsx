// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import type { DrawerBriefingFacts, DrawerBriefingView } from './useDrawerBriefingView'
import { useDrawerBriefingView } from './useDrawerBriefingView'

/**
 * 配置抽屉「日报」屏的只读视图，四态各钉一条：
 *
 * - 读好了 → 三行事实（生成时刻 / 生成语言 / 自动生成），值直接来自那一份期，不另算；
 * - 确实没配期 → `ready` 且 `rows` 为空（空态）；
 * - 读不到（`read` 抛）→ `error` + 重试，**不是**空态；
 * - 重试就是再读一次。
 */
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const period = (overrides: Partial<BriefingPeriod> = {}): BriefingPeriod => Object.freeze({
  id: 'default',
  generationTime: '07:00',
  windowHours: 24 as never,
  language: 'zh-CN',
  ...overrides
})

function Harness(input: Readonly<{ read: () => Promise<DrawerBriefingFacts>; onView: (view: DrawerBriefingView | undefined) => void }>): null {
  input.onView(useDrawerBriefingView(true, input.read))
  return null
}

async function mount(read: () => Promise<DrawerBriefingFacts>): Promise<Readonly<{ current: () => DrawerBriefingView | undefined }>> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let latest: DrawerBriefingView | undefined
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(Harness, { read, onView: (view) => { latest = view } })
    }))
    // 两次 tick：一次给 read 的 promise，一次给 setState 后的重渲染。
    await Promise.resolve()
    await Promise.resolve()
  })
  return { current: () => latest }
}

describe('the drawer’s briefing screen', () => {
  it('shows the three facts from the periods it is given, reading exactly once', async () => {
    const read = vi.fn(async () => ({
      periods: [period(), period({ id: 'evening', generationTime: '21:30', language: 'en-US' as const })],
      autoGeneration: 'on' as const, briefingModel: { state: 'follows-default' as const }
    }))
    const screen = await mount(read)

    const view = screen.current()
    expect(view?.state).toBe('ready')
    if (view?.state !== 'ready') throw new Error('unreachable')
    // 值来自传进来的那一份期：时刻按原样、语言去重、自动生成来自宿主那一档。
    expect(view.rows).toEqual([
      { key: 'configDrawer.rows.publishAt', value: '07:00 · 21:30' },
      { key: 'configDrawer.rows.window', value: '24 小时' },
      { key: 'configDrawer.rows.editions', value: '共 2 期' },
      { key: 'configDrawer.rows.briefingModel', value: '跟随平台默认模型' },
      { key: 'configDrawer.rows.autoGeneration', value: '开' }
    ])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('says the empty state only when there really are no periods', async () => {
    const screen = await mount(async () => ({ periods: [], autoGeneration: 'on', briefingModel: { state: 'follows-default' as const } }))
    expect(screen.current()).toEqual({ state: 'ready', rows: [] })
  })

  it('treats an unreadable read as an error with a retry, never as an empty screen', async () => {
    const screen = await mount(async () => { throw new Error('period-store-unreadable') })
    const view = screen.current()
    expect(view?.state).toBe('error')
    // 空态的形式是 `{state:'ready', rows:[]}`，这两者必须不同。
    expect(view?.state).not.toBe('ready')
  })

  it('reads again when the retry action runs, and shows the new answer', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('period-store-unreadable'))
      .mockResolvedValueOnce({ periods: [period()], autoGeneration: 'off' as const, briefingModel: { state: 'follows-default' as const } })
    const screen = await mount(read)
    const failed = screen.current()
    expect(failed?.state).toBe('error')
    if (failed?.state !== 'error') throw new Error('unreachable')

    await act(async () => {
      failed.onRetry()
      await Promise.resolve()
      await Promise.resolve()
    })

    const view = screen.current()
    expect(view?.state).toBe('ready')
    if (view?.state !== 'ready') throw new Error('unreachable')
    expect(view.rows.find((row) => row.key === 'configDrawer.rows.autoGeneration'))
      .toEqual({ key: 'configDrawer.rows.autoGeneration', value: '关' })
    expect(read).toHaveBeenCalledTimes(2)
  })
})
