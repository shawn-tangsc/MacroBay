// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { expectWaitingFirst } from '@platform/ui/async/expectWaitingFirst'
import { ToastHost } from '@platform/ui/components/toast'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { StorageCacheSettingsPage } from './StorageCacheSettingsPage'

/**
 * 「等的时候画的是加载态，不是终态」（`MI-11-R161`）。
 *
 * 这一条**只能用真实 hook + 未解析的读**来验：页面级用例把 hook 换成了假数据，于是永远从
 * `ready` 开始，正好绕开「首帧」这个唯一的出事点。这里让 IPC 的成功回调悬着，首帧是什么样
 * 就是用户真的看到的那一帧。
 */
function installStorage(read: () => Promise<unknown>, readQuarantine: () => Promise<unknown> = () => new Promise(() => undefined)): void {
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      storage: {
        listCaches: vi.fn(read),
        // 隔离副本是同一屏上的另一条读取；首帧同样是加载态，这里立刻返回一份空清单。
        // 隔离副本同样悬着：这一条判的是「首帧」，两块任何一个先落定都会把首帧写成终态。
        listQuarantineCopies: vi.fn(readQuarantine),
        // 操作记录区块常驻渲染（折叠壳要求 `aria-controls` 指向真实节点），给一行记录，
        // 免得它的空态在首帧冒充「缓存表读完了」。
        listCacheOperations: vi.fn(async () => ({
          records: [{
            operationId: 'op-1',
            cacheId: 'derived.cache',
            ownerType: 'product',
            ownerId: 'sample-product',
            operation: 'clear',
            dryRun: true,
            requestedAt: '2026-07-12T00:00:00.000Z',
            completedAt: '2026-07-12T00:00:01.000Z',
            status: 'skipped'
          }]
        })),
        inspectCache: vi.fn(async () => undefined),
        clearCache: vi.fn(async () => undefined),
        compactCache: vi.fn(async () => undefined)
      }
    }
  })
}

const caches = [
  {
    cacheId: 'derived.cache',
    ownerType: 'product' as const,
    ownerId: 'sample-product',
    displayName: 'Derived analysis cache',
    displayNameI18n: { 'zh-CN': '派生分析缓存', 'en-US': 'Derived analysis cache' },
    description: 'Derived AI results',
    descriptionI18n: { 'zh-CN': '派生 AI 结果', 'en-US': 'Derived AI results' },
    category: 'derived-data' as const,
    cacheKind: 'sqlite-derived' as const,
    durability: 'persisted-derived' as const,
    sensitivity: 'none' as const,
    clearable: true,
    compactable: false,
    backupPolicy: 'exclude' as const,
    warnings: [],
    latestInspection: {
      cacheId: 'derived.cache',
      status: 'ready' as const,
      recordCount: 1,
      sizeBytes: 32,
      lastUpdatedAt: '2026-07-12T00:00:00.000Z'
    }
  }
]


describe('storage cache read: first frame', () => {
  afterEach(() => {
    document.body.replaceChildren()
    Reflect.deleteProperty(window, 'platform')
  })

  it('draws the loading state, never a settled one, before the first read resolves', async () => {
    let resolveRead: (value: unknown) => void = () => undefined
    const pending = new Promise<unknown>((resolve) => {
      resolveRead = resolve
    })
    installStorage(() => pending)

    await expectWaitingFirst(
      <ToastHost>
        <ShellLanguageProvider language="en-US">
          <StorageCacheSettingsPage language="en-US" />
        </ShellLanguageProvider>
      </ToastHost>
    )

    // 读一旦回来，同一棵树要能翻成表格——「首帧是加载态」不等于「永远停在加载态」。
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <ToastHost>
          <ShellLanguageProvider language="en-US">
            <StorageCacheSettingsPage language="en-US" />
          </ShellLanguageProvider>
        </ToastHost>
      )
    })
    await act(async () => {
      resolveRead(caches)
      await pending
    })
    expect(host.innerHTML).toContain('Derived analysis cache')
    // 只看缓存表那一块：隔离副本是同一屏上另一条读取，它还悬着不影响这一条的结论。
    const cachePanel = [...host.querySelectorAll('section.storage-cache-panel')]
      .find((panel) => !panel.hasAttribute('data-quarantine-copies'))
    expect(cachePanel, 'cache panel').toBeDefined()
    expect(cachePanel!.querySelector('[data-loading-state]')).toBeNull()
    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
})
