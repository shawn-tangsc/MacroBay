/**
 * Owner: platform/desktop/main/workspace。
 *
 * **跨层契约用例**：渲染侧真实的 `createWorkspaceTabClient` ↔ 主进程真实的 `.tabs.*` handler。
 * 它回答的是一个此前没人钉住、真机上却踩了的问题——**「只传 `menuKey` 能不能开出页签」**。
 *
 * 为什么值得单开一条：renderer 侧发的是 `{ method: 'openTab', menuKey }`，主进程要自己按菜单键查注册表；
 * 中间任何一层变了（白名单、注册表、重命名），症状都只有「点了没反应」——因为拒绝是**返回值**，不是异常：
 * `status: 'rejected'` + `errorCode`，`catch` 一个字都接不到。所以这里既断言「开得出来」，也断言
 * 「开不出来时 errorCode 说的是什么」，让下一次能在日志里直接读到原因。
 */
import { describe, expect, it } from 'vitest'

import { builtInWorkspacePages, builtInWorkspacePageModuleIds } from '@platform/workspace/registry/builtInWorkspacePages'
import { createWorkspacePageRegistry, toProductWorkspacePage } from '@platform/workspace/registry/workspacePageRegistry'
import { createWorkspaceTabStore } from '@platform/workspace/runtime/workspaceTabStore'
import { createWorkspaceTabClient } from '../../../../apps/desktop-shell/src/renderer/src/shell/workspace/workspaceClient'
import { createTabWorkspaceIpcHandlers } from './tabWorkspaceIpcHandlers'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

const PRODUCT = 'market-intelligence'
const PAGE_ID = `${PRODUCT}.intelligence`
const MENU_KEY = `/${PRODUCT}/intelligence`

function createHarness() {
  const windowRegistry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-1` })
  windowRegistry.registerMainWindow({ webContentsId: 10 })
  const pageRegistry = createWorkspacePageRegistry({
    moduleIds: [...builtInWorkspacePageModuleIds, PAGE_ID],
    productIds: [PRODUCT]
  })
  for (const page of builtInWorkspacePages) pageRegistry.register(page)
  // **带 home 注册**：字段白名单漏掉 `home` 时这里就抛（`invalid-registration`），
  // 而真机上那一下会被组合根的 fail-soft 吞掉，只剩「菜单看得见、点它没反应」。
  pageRegistry.register(toProductWorkspacePage(PRODUCT, {
    id: 'intelligence',
    title: { 'zh-CN': '情报', 'en-US': 'Intelligence' },
    icon: 'radar',
    order: 10,
    module: './desktop/pages/intelligence',
    home: true
  }))
  pageRegistry.seal()

  const tabStore = createWorkspaceTabStore({
    pageRegistry,
    createOpaqueId: (prefix = 'id') => `tab-${prefix}-1`
  })
  const handlers = createTabWorkspaceIpcHandlers({
    pageRegistry, tabStore, windowRegistry, release: () => undefined
  })
  const event = { sender: { id: 10, isDestroyed: () => false }, senderFrame: { parent: null } }
  const bridge = {
    tabsGetSnapshot: () => Promise.resolve(handlers.getSnapshot(event)),
    tabsCommand: (request: unknown) => Promise.resolve(handlers.command(event, request)),
    onEvent: () => () => undefined
  }
  return { client: createWorkspaceTabClient(bridge as never), pageRegistry }
}

describe('openTab 只传 menuKey 时，主进程按菜单键解析出页面（真机 2026-11-06 的根因）', () => {
  it('shell 发出的 { menuKey } 就足够开出页签，返回快照里真的有这一页', async () => {
    const { client } = createHarness()
    const loaded = await client.load()
    expect(loaded).not.toBeNull()

    const result = await client.port.openTab({ menuKey: MENU_KEY })

    expect(result.status).toBe('applied')
    expect(result.snapshot.tabs.filter((tab) => tab.open).map((tab) => tab.pageId)).toEqual([PAGE_ID])
    expect(result.snapshot.activeWorkspaceInstanceKey).toEqual(expect.any(String))
  })

  it('pageId 与 menuKey 二选一都行：两条解析路径不许分叉', async () => {
    const { client } = createHarness()
    await client.load()

    const result = await client.port.openTab({ pageId: PAGE_ID })

    expect(result.status).toBe('applied')
    expect(result.snapshot.tabs.map((tab) => tab.menuKey)).toEqual([MENU_KEY])
  })

  it('解析不到时，拒绝说的是 registration-missing（这就是日志里该出现的那个词）', async () => {
    const { client } = createHarness()
    await client.load()

    const result = await client.port.openTab({ menuKey: '/nobody/nowhere' })

    // 拒绝是**返回值**：`catch` 接不到，所以调用方必须显式处理它，否则界面上只剩「点了没反应」。
    expect(result.status).toBe('rejected')
    expect(result.errorCode).toBe('registration-missing')
  })

  it('两个选择器都不给、或都给，一律 invalid-request（renderer 不许自造身份）', async () => {
    const { client } = createHarness()
    await client.load()

    expect((await client.port.openTab({})).errorCode).toBe('invalid-request')
    expect((await client.port.openTab({ pageId: PAGE_ID, menuKey: MENU_KEY })).errorCode).toBe('invalid-request')
  })
})
