// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveStateViewText, STATE_VIEW_ACTION_KEYS, stateViewTextKeys } from '@platform/ui/components/state'
import { ToastHost } from '@platform/ui/components/toast'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { formatShellInstant, resolveSystemTimeZone } from '@platform/ui/time/shellTimeFormat'

import { platformText } from '../../../i18n/platformText'
import { StorageCacheSettingsPage } from './StorageCacheSettingsPage'

/**
 * 隔离副本那一块的三态（用户 2026-11-12 的缺陷：磁盘上有 `.corrupt-*`、界面完全看不见）。
 *
 * 判据互相排斥，缺一条就会出现「读不到被画成没有」：
 * - 扫到了 → 列出文件 / 位置 / 大小 / 修改时间（时间按读者时区格式化）；
 * - 扫完了确实没有 → 空态；
 * - 根目录读不到 → 错误态 + 重试（**不是**空态）；
 * - 有目录没读到 → 列表照出，但明说「可能不全」并给重试。
 */
const labels = platformText['en-US'].storageCache
const zhLabels = platformText['zh-CN'].storageCache

const mockQuarantine = vi.hoisted(() => ({
  state: { status: 'ready', data: { copies: [], unreadableDirectories: 0, truncated: false } } as unknown,
  reload: vi.fn(async () => undefined)
}))

/** 页头那颗刷新只驱动缓存表那次读取（另有一个 mock）；断言它是否也带动隔离副本。 */
const mockCacheReload = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('./useQuarantineCopies', () => ({
  useQuarantineCopies: () => ({ state: mockQuarantine.state, reload: mockQuarantine.reload })
}))

vi.mock('./useStorageCacheSettings', () => ({
  useStorageCacheSettings: () => ({
    // 缓存表本身不是这一组用例的被测对象：给一份最小 ready，让页面画得出来。
    state: { status: 'ready', data: { caches: [], operations: [] } },
    reload: mockCacheReload,
    inspectCache: async () => undefined,
    clearCache: async () => undefined,
    compactCache: async () => undefined
  })
}))

let root: Root | undefined
let container: HTMLElement | undefined

beforeEach(() => {
  mockQuarantine.state = { status: 'ready', data: { copies: [], unreadableDirectories: 0, truncated: false } }
  mockQuarantine.reload.mockClear()
  mockCacheReload.mockClear()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
  document.body.replaceChildren()
})

async function render(): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <ShellLanguageProvider language="en-US">
        <ToastHost>
          <StorageCacheSettingsPage language="en-US" />
        </ToastHost>
      </ShellLanguageProvider>
    )
  })
  return container
}

/** 打开隔离副本那一块的折叠按钮（它默认收起，与操作记录一致）。 */
async function openQuarantine(): Promise<void> {
  // 折叠头是平台壳（antd Collapse）：整行是 `role="button"` 的 header，不是原生 `<button>`。
  const toggle = quarantineSection()?.querySelector<HTMLElement>('.ant-collapse-header')
  expect(toggle, 'quarantine section toggle').toBeDefined()
  await act(async () => { toggle!.click() })
  await act(async () => { await Promise.resolve() })
}

function quarantineSection(): Element | null {
  // 按页面给的锚点取，不按「哪个 section 的文字里有标题」猜：根 section 也包含标题。
  return container?.querySelector('[data-quarantine-copies="true"]') ?? null
}

describe('storage page · quarantine copies', () => {
  it('lists the copies with their location, size and a reader-time-zone timestamp', async () => {
    mockQuarantine.state = {
      status: 'ready',
      data: {
        copies: [{
          fileName: 'settings.json.corrupt-1762345678901',
          relativePath: 'platform/settings.json.corrupt-1762345678901',
          sizeBytes: 2048,
          modifiedAt: '2026-11-12T01:02:03.000Z'
        }],
        unreadableDirectories: 0,
        truncated: false
      }
    }
    await render()
    await openQuarantine()

    const section = quarantineSection()
    expect(section).not.toBeNull()
    expect(section!.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(section!.textContent).toContain('settings.json.corrupt-1762345678901')
    expect(section!.textContent).toContain('platform/settings.json.corrupt-1762345678901')
    expect(section!.textContent).toContain('2.0 KB')
    // 时间走统一格式化、按读者时区：断言与格式化器同一个结果，不在这里手拼日期。
    expect(section!.textContent).toContain(
      formatShellInstant('2026-11-12T01:02:03.000Z', { timeZone: resolveSystemTimeZone(), locale: 'en-US' })
    )
    // 没有可读性问题时不出「可能不全」那句。
    expect(section!.textContent).not.toContain(labels.quarantinePartial(1))
  })

  it('says "nothing to list" in its own words when the scan completed (0 copies is healthy, not pending)', async () => {
    await render()
    await openQuarantine()

    const section = quarantineSection()!
    expect(section.querySelector('[data-state="empty"]')).not.toBeNull()
    expect(section.querySelector('[data-state="error"]')).toBeNull()
    // 平台那句是「等有数据进来后这里就会出现」——可本机 0 份是健康状态，用自己的句子说清。
    expect(section.textContent).toContain(labels.quarantineEmpty)
    expect(section.textContent).not.toContain(resolveStateViewText('en-US', stateViewTextKeys('empty', 'not-yet').reason))
    // 空态不给动作：确实没有就是没有，不用一颗按不动的重试。
    expect(section.textContent).not.toContain(resolveStateViewText('en-US', STATE_VIEW_ACTION_KEYS.retry))
  })

  it('uses the platform collapsible head (one implementation on this screen) with the count as meta', async () => {
    mockQuarantine.state = {
      status: 'ready',
      data: { copies: [{ fileName: 'a.json.corrupt-1', relativePath: 'a.json.corrupt-1', sizeBytes: 1, modifiedAt: '2026-11-12T01:02:03.000Z' }], unreadableDirectories: 0, truncated: false }
    }
    await render()

    const section = quarantineSection()!
    // 折叠头是平台壳：`collapsible-group` 的头行，箭头在最右、整行可点；这一屏不再有第二套手写折叠头。
    expect(section.querySelector('.collapsible-group')).not.toBeNull()
    expect(section.querySelector('.collapsible-group__title')?.textContent).toBe(labels.quarantineTitle)
    // 计数走壳的 meta 槽（11 / 400 / muted），不再是我手写的 `<small>`。
    expect(section.querySelector('.collapsible-group__meta')?.textContent).toBe('1')
    // 整屏只剩平台壳：两个折叠区（隔离副本 + 操作记录），没有第二个手写头。
    expect(container!.querySelectorAll('.collapsible-group')).toHaveLength(2)
    expect(section.querySelector('.storage-cache-history-toggle')).toBeNull()
  })

  it('shows a failed read as an error with a retry, never as an empty list', async () => {
    mockQuarantine.state = { status: 'error', reasonCode: 'unreadable' }
    await render()
    await openQuarantine()

    const section = quarantineSection()!
    expect(section.querySelector('[data-state="error"]')).not.toBeNull()
    expect(section.querySelector('[data-state="empty"]')).toBeNull()
    expect(section.textContent).toContain(
      resolveStateViewText('en-US', stateViewTextKeys('error', 'unreadable').reason)
    )

    const retry = [...section.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === resolveStateViewText('en-US', STATE_VIEW_ACTION_KEYS.retry))
    expect(retry).toBeDefined()
    await act(async () => { retry!.click() })
    expect(mockQuarantine.reload).toHaveBeenCalledOnce()
  })

  it('keeps the list but says it may be incomplete when a folder could not be read', async () => {
    mockQuarantine.state = {
      status: 'ready',
      data: {
        copies: [{
          fileName: 'a.json.corrupt-1762345678902',
          relativePath: 'products/a.json.corrupt-1762345678902',
          sizeBytes: 12,
          modifiedAt: '2026-11-12T01:02:03.000Z'
        }],
        unreadableDirectories: 2,
        truncated: false
      }
    }
    await render()
    await openQuarantine()

    const section = quarantineSection()!
    // 读不到的目录不许把已经扫到的那份吞掉，也不许说成「没有副本」。
    expect(section.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(section.textContent).toContain(labels.quarantinePartial(2))
    expect(section.querySelector('[data-state="empty"]')).toBeNull()
    const retry = [...section.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === labels.refresh)
    expect(retry).toBeDefined()
    await act(async () => { retry!.click() })
    expect(mockQuarantine.reload).toHaveBeenCalledOnce()
  })

  it('refreshes both reads from the page-level refresh, so neither block claims to be newer', async () => {
    await render()

    const refresh = [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.textContent === labels.refresh)
    expect(refresh).toBeDefined()
    await act(async () => { refresh!.click() })
    expect(mockCacheReload).toHaveBeenCalledOnce()
    expect(mockQuarantine.reload).toHaveBeenCalledOnce()
  })

  it('explains what the copies are behind the ⓘ, and keeps the explanation out of the body', async () => {
    await render()
    await openQuarantine()

    const section = quarantineSection()!
    // 说明只在 ⓘ 里：正文（含读屏文本）不出现那句长解释。
    expect(section.textContent).not.toContain(labels.quarantineWhat)
    const trigger = section.querySelector<HTMLButtonElement>(`button[aria-label="${labels.quarantineWhatAria}"]`)
    expect(trigger).not.toBeNull()
    await act(async () => { trigger!.click() })
    await act(async () => { await Promise.resolve() })
    const describedBy = trigger!.getAttribute('aria-describedby') ?? ''
    const popover = describedBy.split(' ').map((id) => document.getElementById(id)).find((node) => node !== null)
    expect(popover?.textContent).toContain(labels.quarantineWhat)
    // 中文一句也核对：说明是两句独立的文案，引错表会得到英文。
    expect(zhLabels.quarantineWhat).not.toBe(labels.quarantineWhat)
  })
})
