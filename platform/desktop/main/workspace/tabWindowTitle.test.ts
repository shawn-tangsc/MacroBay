import { describe, expect, it } from 'vitest'

import { builtInWorkspacePages, builtInWorkspacePageModuleIds } from '@platform/workspace/registry/builtInWorkspacePages'
import { createWorkspacePageRegistry, toProductWorkspacePage } from '@platform/workspace/registry/workspacePageRegistry'
import { createWorkspaceTabStore } from '@platform/workspace/runtime/workspaceTabStore'
import { createTabDetachedWindowHost } from './tabDetachedWindowHost'
import { createTabWorkspaceIpcHandlers } from './tabWorkspaceIpcHandlers'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（PLAT-41 RED，Main 侧页窗那一半）。
 *
 * 判据：`.tabs.detachTab` 交给工厂的 `title` 必须是**当前宿主语言的页面名**（此前恒取 en-US），
 * 并同时带 `allowedTitles`（两种语言的页面名 + pageId 兜底）—— 只有这份受控白名单能让
 * `page-title-updated` 收口既不挡语言跟随、也不放行入口 HTML 的应用名/篡改。
 */
const PAGE_ID = 'fixture.market'

function createPageRegistry() {
  const registry = createWorkspacePageRegistry({
    moduleIds: [...builtInWorkspacePageModuleIds, PAGE_ID], productIds: ['fixture']
  })
  for (const page of builtInWorkspacePages) registry.register(page)
  registry.register(toProductWorkspacePage('fixture', {
    id: 'market', title: { 'zh-CN': '行情图表', 'en-US': 'Market chart' },
    icon: 'chart-candlestick', order: 1, module: PAGE_ID
  }))
  registry.seal()
  return registry
}

describe('PLAT-41 页窗建窗标题（Main 侧）', () => {
  it('detachTab 把本地化标题 + 双语言白名单交给宿主（不再恒为 en-US）', async () => {
    let sequence = 0
    const windowRegistry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
    windowRegistry.registerMainWindow({ webContentsId: 10 })
    const pageRegistry = createPageRegistry()
    const tabStore = createWorkspaceTabStore({ pageRegistry, createOpaqueId: (prefix = 'id') => `tab-${prefix}-${++sequence}` })
    const requests: { title?: string; allowedTitles?: readonly string[] }[] = []
    const fakeHost = {
      requestTabDetach: async (input: { title: string; allowedTitles?: readonly string[]; workspaceInstanceKey: string; hostEpoch?: number; windowInstanceId?: string }) => {
        requests.push({ title: input.title, allowedTitles: input.allowedTitles })
        return { status: 'awaiting-ready' as const, windowInstanceId: input.windowInstanceId ?? 'window-1', hostEpoch: input.hostEpoch ?? 2 }
      }
    }
    const handlers = createTabWorkspaceIpcHandlers({
      pageRegistry, tabStore, windowRegistry,
      host: fakeHost as never,
      release: () => undefined,
      resolveTitle: async (registration) => registration.title?.['zh-CN'] ?? ''
    })
    const sender = { senderFrame: { parent: null }, sender: { id: 10, isDestroyed: () => false } }
    const opened = await handlers.command(sender, {
      method: 'openTab', requestId: 'req-open', expectedRevision: 0, pageId: PAGE_ID
    })
    expect(opened.status).toBe('applied')
    const detached = await handlers.command(sender, {
      method: 'detachTab', requestId: 'req-detach', expectedRevision: tabStore.getSnapshot().layoutRevision,
      workspaceInstanceKey: opened.workspaceInstanceKey as string
    })
    expect(detached.status).toBe('applied')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.title).toBe('行情图表')
    expect(requests[0]?.allowedTitles).toEqual(['行情图表', PAGE_ID, 'Market chart'])
  })

  it('createTabDetachedWindowHost 把 allowedTitles 原样透传给共享宿主（registry 身份采纳成功时）', async () => {
    let sequence = 0
    const windowRegistry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
    const captured: { title?: string; allowedTitles?: readonly string[] }[] = []
    const host = {
      requestDetach: async (input: { title: string; allowedTitles?: readonly string[] }) => {
        captured.push({ title: input.title, allowedTitles: input.allowedTitles })
        return { status: 'awaiting-ready' as const, windowInstanceId: 'window-tab-1', hostEpoch: 2 }
      },
      pendingOperationIds: () => [] as readonly string[],
      committedOwners: () => [] as readonly string[],
      handleNativeClose: () => ({ status: 'ignored' as const, reason: 'unsupported' as const }),
      redockedByUser: () => undefined,
      closeDetachedWindow: () => ({ status: 'closed' as const }),
      reportWindowFailure: () => ({ status: 'rolled-back' as const, operationId: '', fallbackReason: 'window-crashed' as const, fallbackMode: undefined })
    }
    const reserved = windowRegistry.reserveDetachedTabWindow({
      windowInstanceId: 'window-tab-1', hostEpoch: 3, workspaceInstanceKey: 'workspace-tab-1'
    })
    expect(reserved.status).toBe('reserved')
    const tabHost = createTabDetachedWindowHost({ host: host as never, registry: windowRegistry })
    const outcome = await tabHost.requestTabDetach({
      operationId: 'op-1', workspaceInstanceKey: 'workspace-tab-1', pageId: PAGE_ID, menuKey: `/${PAGE_ID}`,
      title: '行情图表', allowedTitles: ['行情图表', 'Market chart'],
      sourceHost: { windowInstanceId: 'main', hostEpoch: 2 },
      windowInstanceId: 'window-tab-1', hostEpoch: 3
    })
    expect(outcome.status).toBe('awaiting-ready')
    expect(captured).toEqual([{ title: '行情图表', allowedTitles: ['行情图表', 'Market chart'] }])
  })
})
