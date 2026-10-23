import { describe, expect, it } from 'vitest'

import type { WorkspacePageRegistration } from '../contracts'
import { WorkspaceTabPolicy } from '../policies'
import { createWorkspacePageRegistry } from '../registry/workspacePageRegistry'
import { createWorkspaceTabStore } from './workspaceTabStore'

/**
 * P2-01 focused：Tab runtime（Main 纯描述权威）。七类场景：A/B/A、重复 open、multi-instance、
 * detached 再点 focus、closed history、last-tab、bind 原地恢复（完整 bind 矩阵见 workspaceTabBinding.test.ts）。
 */

/** pageId 采用 `<productId>.<localId>` 的全局稳定 id；menuKey 与产品路由路径同规则。 */
function registration(pageId: string, overrides: Partial<WorkspacePageRegistration> = {}): WorkspacePageRegistration {
  const [productId] = pageId.split('.')
  return {
    pageId,
    menuKey: `/${pageId.split('.').join('/')}`,
    title: { 'zh-CN': pageId, 'en-US': pageId },
    icon: 'home',
    module: pageId,
    productId,
    supportsDetached: true,
    allowMultipleInstances: false,
    binding: { persistence: 'none', maxKeyBytes: 256 },
    ...overrides
  }
}

function createStore(pages: readonly WorkspacePageRegistration[]) {
  let sequence = 0
  const registry = createWorkspacePageRegistry({
    moduleIds: pages.map((page) => page.module),
    productIds: [...new Set(pages.flatMap((page) => (page.productId === undefined ? [] : [page.productId])))]
  })
  pages.forEach((page) => registry.register(page))
  registry.seal()
  const store = createWorkspaceTabStore({
    pageRegistry: registry,
    createOpaqueId: (prefix = 'id') => `${prefix}-${++sequence}`
  })
  return {
    store,
    rev: () => store.getSnapshot().layoutRevision,
    main: { requestScope: 'main', hostEpoch: 1 } as const
  }
}

describe('workspace tab store：A/B/A 与重复 open', () => {
  it('A/B/A：第三次 open 聚焦既有 tab，只留两个实例', async () => {
    const { store, rev, main } = createStore([registration('sample.alpha'), registration('sample.beta')])

    const alpha = await store.openTab({ ...main, requestId: 'a1', expectedRevision: rev(), pageId: 'sample.alpha' })
    const beta = await store.openTab({ ...main, requestId: 'b1', expectedRevision: rev(), pageId: 'sample.beta' })
    const again = await store.openTab({ ...main, requestId: 'a2', expectedRevision: rev(), pageId: 'sample.alpha' })

    expect([alpha.status, beta.status, again.status]).toEqual(['applied', 'applied', 'applied'])
    expect(again.workspaceInstanceKey).toBe(alpha.workspaceInstanceKey)
    expect(store.getSnapshot().tabs.map((tab) => [tab.pageId, tab.open])).toEqual([
      ['sample.alpha', true], ['sample.beta', true]
    ])
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBe(alpha.workspaceInstanceKey)
  })

  it('重复 open 幂等：同 pageId + bindingKey 聚焦既有实例，状态没变就不抬 revision', async () => {
    const { store, rev, main } = createStore([
      registration('sample.alpha', { binding: { persistence: 'session', maxKeyBytes: 256 } })
    ])

    const first = await store.openTab({ ...main, requestId: 'o1', expectedRevision: rev(), pageId: 'sample.alpha', bindingKey: 'acct-1' })
    const before = store.getSnapshot().layoutRevision
    const second = await store.openTab({ ...main, requestId: 'o2', expectedRevision: rev(), pageId: 'sample.alpha', bindingKey: 'acct-1' })

    expect(second.workspaceInstanceKey).toBe(first.workspaceInstanceKey)
    expect(store.getSnapshot().tabs).toHaveLength(1)
    expect(store.getSnapshot().layoutRevision).toBe(before)
    expect(store.getSnapshot().tabs[0]?.bindingState).toBe('bound')
  })
})

describe('workspace tab store：multi-instance 与 detached 再点', () => {
  it('multi-instance：只有显式 newInstance + 显式允许多实例才分配新实例', async () => {
    const { store, rev, main } = createStore([
      registration('sample.multi', { allowMultipleInstances: true }),
      registration('sample.single', { binding: { persistence: 'session', maxKeyBytes: 256 } })
    ])

    const first = await store.openTab({ ...main, requestId: 'm1', expectedRevision: rev(), pageId: 'sample.multi', newInstance: true })
    const second = await store.openTab({ ...main, requestId: 'm2', expectedRevision: rev(), pageId: 'sample.multi', newInstance: true })
    expect(second.workspaceInstanceKey).not.toBe(first.workspaceInstanceKey)
    expect(store.getSnapshot().tabs.filter((tab) => tab.pageId === 'sample.multi')).toHaveLength(2)

    await expect(store.openTab({ ...main, requestId: 'm3', expectedRevision: rev(), pageId: 'sample.single', newInstance: true }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })

    await store.openTab({ ...main, requestId: 'm4', expectedRevision: rev(), pageId: 'sample.single', bindingKey: 'acct-1' })
    // 单实例页面上换 bindingKey 也不得偷偷多开一个实例：显式拒绝而不是复用/扩实例
    await expect(store.openTab({ ...main, requestId: 'm5', expectedRevision: rev(), pageId: 'sample.single', bindingKey: 'acct-2' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    expect(store.getSnapshot().tabs.filter((tab) => tab.pageId === 'sample.single')).toHaveLength(1)

    // 只有主窗有本应用布局管理权：未登记宿主不能新建 tab
    await expect(store.openTab({ requestId: 'm6', requestScope: 'window-x', expectedRevision: rev(), hostEpoch: 2, windowInstanceId: 'window-x', pageId: 'sample.multi' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'not-owner' })
    expect(store.getSnapshot().tabs.filter((tab) => tab.pageId === 'sample.multi')).toHaveLength(2)
  })

  it('detached 再点：聚焦既有独立实例，不新建第二个页面也不改容器', async () => {
    const { store, rev, main } = createStore([registration('sample.alpha')])
    const opened = await store.openTab({ ...main, requestId: 'd1', expectedRevision: rev(), pageId: 'sample.alpha' })
    const key = opened.workspaceInstanceKey as string

    const detached = await store.detachTab({ ...main, requestId: 'd2', expectedRevision: rev(), workspaceInstanceKey: key })
    expect(detached.status).toBe('applied')
    const detachedTab = store.getSnapshot().tabs[0]
    expect(detachedTab).toMatchObject({ pageId: 'sample.alpha', open: true, mode: 'detached' })
    expect(detachedTab?.windowInstanceId).not.toBe('main')

    const focused = await store.openTab({ ...main, requestId: 'd3', expectedRevision: rev(), pageId: 'sample.alpha' })
    expect(focused.workspaceInstanceKey).toBe(key)
    expect(store.getSnapshot().tabs).toHaveLength(1)
    expect(store.getSnapshot().tabs[0]).toMatchObject({
      mode: 'detached', windowInstanceId: detachedTab?.windowInstanceId, hostEpoch: detachedTab?.hostEpoch
    })
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBe(key)

    // 主窗有布局管理权（技术设计 §4）：可激活自己派生的独立实例
    await expect(store.activateTab({ ...main, requestId: 'd4', expectedRevision: rev(), workspaceInstanceKey: key }))
      .resolves.toMatchObject({ status: 'applied' })
    // 陈旧/无关宿主不得操作他人的独立实例
    await expect(store.activateTab({
      requestId: 'd5', requestScope: 'window-other', expectedRevision: rev(), hostEpoch: 2,
      windowInstanceId: 'window-other', workspaceInstanceKey: key
    })).resolves.toMatchObject({ status: 'rejected', errorCode: 'not-owner' })
    expect(store.getSnapshot().tabs[0]?.mode).toBe('detached')
  })
})

describe('workspace tab store：closed history 与 last-tab', () => {
  it('closed history：最近关闭有界（最新在前），reopenLastClosed 原地恢复且不新增实例', async () => {
    const pages = Array.from({ length: 12 }, (_, index) => registration(`sample.p${String(index).padStart(2, '0')}`))
    const { store, rev, main } = createStore(pages)

    const keys: string[] = []
    for (const [index, page] of pages.entries()) {
      const opened = await store.openTab({ ...main, requestId: `open-${index}`, expectedRevision: rev(), pageId: page.pageId })
      keys.push(opened.workspaceInstanceKey as string)
    }
    for (const [index, key] of keys.entries()) {
      await expect(store.closeTab({ ...main, requestId: `close-${index}`, expectedRevision: rev(), workspaceInstanceKey: key }))
        .resolves.toMatchObject({ status: 'applied' })
    }

    expect(store.getSnapshot().tabs).toHaveLength(12)
    expect(store.getSnapshot().tabs.every((tab) => tab.open === false)).toBe(true)
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBeNull()
    expect(store.recentlyClosed()).toHaveLength(WorkspaceTabPolicy.maxRecentlyClosed)
    expect(store.recentlyClosed().map((entry) => entry.pageId)).toEqual(
      Array.from({ length: WorkspaceTabPolicy.maxRecentlyClosed }, (_, index) => `sample.p${String(11 - index).padStart(2, '0')}`)
    )

    const reopened = await store.reopenLastClosed({ ...main, requestId: 'reopen-1', expectedRevision: rev() })
    expect(reopened.workspaceInstanceKey).toBe(keys[11])
    expect(store.getSnapshot().tabs.find((tab) => tab.workspaceInstanceKey === keys[11])).toMatchObject({ open: true })
    expect(store.getSnapshot().tabs).toHaveLength(12)
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBe(keys[11])
    expect(store.recentlyClosed()[0]?.pageId).toBe('sample.p10')

    for (let round = 0; round < WorkspaceTabPolicy.maxRecentlyClosed - 1; round += 1) {
      await expect(store.reopenLastClosed({ ...main, requestId: `reopen-${round + 2}`, expectedRevision: rev() }))
        .resolves.toMatchObject({ status: 'applied' })
    }
    expect(store.recentlyClosed()).toEqual([])
    await expect(store.reopenLastClosed({ ...main, requestId: 'reopen-empty', expectedRevision: rev() }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
  })

  it('last-tab：关闭最后一个 tab 得到空工作区（不自动重开），再次打开原地恢复同一实例', async () => {
    const { store, rev, main } = createStore([registration('sample.alpha'), registration('sample.beta')])
    const opened = await store.openTab({ ...main, requestId: 'l1', expectedRevision: rev(), pageId: 'sample.alpha' })
    const key = opened.workspaceInstanceKey as string

    await expect(store.closeTab({ ...main, requestId: 'l2', expectedRevision: rev(), workspaceInstanceKey: key }))
      .resolves.toMatchObject({ status: 'applied' })
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBeNull()
    expect(store.getSnapshot().tabs.map((tab) => [tab.pageId, tab.open])).toEqual([['sample.alpha', false]])

    const reopened = await store.openTab({ ...main, requestId: 'l3', expectedRevision: rev(), pageId: 'sample.alpha' })
    expect(reopened.workspaceInstanceKey).toBe(key)
    expect(store.getSnapshot().tabs).toHaveLength(1)
    expect(store.getSnapshot().tabs[0]).toMatchObject({ open: true, order: 0 })
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBe(key)

    // 空工作区仍可打开菜单里的其它页面
    await expect(store.openTab({ ...main, requestId: 'l4', expectedRevision: rev(), pageId: 'sample.beta' }))
      .resolves.toMatchObject({ status: 'applied' })
    expect(store.getSnapshot().tabs.map((tab) => [tab.pageId, tab.open])).toEqual([
      ['sample.alpha', true], ['sample.beta', true]
    ])
  })

  it('关闭活动 tab 后选中同序后继，没有后继才回退到前一个仍打开的 tab', async () => {
    const { store, rev, main } = createStore([
      registration('sample.alpha'), registration('sample.beta'), registration('sample.gamma')
    ])
    const alpha = await store.openTab({ ...main, requestId: 's1', expectedRevision: rev(), pageId: 'sample.alpha' })
    const beta = await store.openTab({ ...main, requestId: 's2', expectedRevision: rev(), pageId: 'sample.beta' })
    const gamma = await store.openTab({ ...main, requestId: 's3', expectedRevision: rev(), pageId: 'sample.gamma' })

    await store.activateTab({ ...main, requestId: 's4', expectedRevision: rev(), workspaceInstanceKey: beta.workspaceInstanceKey as string })
    await store.closeTab({ ...main, requestId: 's5', expectedRevision: rev(), workspaceInstanceKey: beta.workspaceInstanceKey as string })
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBe(gamma.workspaceInstanceKey)

    await store.closeTab({ ...main, requestId: 's6', expectedRevision: rev(), workspaceInstanceKey: gamma.workspaceInstanceKey as string })
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBe(alpha.workspaceInstanceKey)
  })
})

describe('workspace tab store：批量关闭、顺序与容量边界', () => {
  it('closeOthers / closeRight 只关闭目标之外的打开项，顺序与活动项保持自洽', async () => {
    const { store, rev, main } = createStore([
      registration('sample.alpha'), registration('sample.beta'),
      registration('sample.gamma'), registration('sample.delta')
    ])
    const keys: string[] = []
    for (const [index, pageId] of ['sample.alpha', 'sample.beta', 'sample.gamma', 'sample.delta'].entries()) {
      const opened = await store.openTab({ ...main, requestId: `c-${index}`, expectedRevision: rev(), pageId })
      keys.push(opened.workspaceInstanceKey as string)
    }

    await expect(store.closeRight({ ...main, requestId: 'cr', expectedRevision: rev(), workspaceInstanceKey: keys[1] as string }))
      .resolves.toMatchObject({ status: 'applied' })
    expect(store.getSnapshot().tabs.map((tab) => tab.open)).toEqual([true, true, false, false])
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBe(keys[1])

    await expect(store.closeOthers({ ...main, requestId: 'co', expectedRevision: rev(), workspaceInstanceKey: keys[1] as string }))
      .resolves.toMatchObject({ status: 'applied' })
    expect(store.getSnapshot().tabs.map((tab) => [tab.pageId, tab.open])).toEqual([
      ['sample.alpha', false], ['sample.beta', true], ['sample.gamma', false], ['sample.delta', false]
    ])
    expect(store.recentlyClosed().map((entry) => entry.pageId)).toEqual(['sample.alpha', 'sample.delta', 'sample.gamma'])
  })

  it('reorder 只接受全部实例键的一个排列，非法请求 fail closed', async () => {
    const { store, rev, main } = createStore([registration('sample.alpha'), registration('sample.beta')])
    const alpha = await store.openTab({ ...main, requestId: 'r1', expectedRevision: rev(), pageId: 'sample.alpha' })
    const beta = await store.openTab({ ...main, requestId: 'r2', expectedRevision: rev(), pageId: 'sample.beta' })

    await expect(store.reorderTabs({
      ...main, requestId: 'r3', expectedRevision: rev(),
      workspaceInstanceKeys: [beta.workspaceInstanceKey as string, alpha.workspaceInstanceKey as string]
    })).resolves.toMatchObject({ status: 'applied' })
    expect(store.getSnapshot().tabs.map((tab) => tab.pageId)).toEqual(['sample.beta', 'sample.alpha'])
    expect(store.getSnapshot().tabs.map((tab) => tab.order)).toEqual([0, 1])

    await expect(store.reorderTabs({ ...main, requestId: 'r4', expectedRevision: rev(), workspaceInstanceKeys: [alpha.workspaceInstanceKey as string] }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    await expect(store.reorderTabs({
      ...main, requestId: 'r5', expectedRevision: rev(),
      workspaceInstanceKeys: [alpha.workspaceInstanceKey as string, alpha.workspaceInstanceKey as string]
    })).resolves.toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    expect(store.getSnapshot().tabs.map((tab) => tab.pageId)).toEqual(['sample.beta', 'sample.alpha'])
  })

  it('打开数量达到具名上限后拒绝新开，绝不逐出已打开实例', async () => {
    const { store, rev, main } = createStore([registration('sample.multi', { allowMultipleInstances: true })])

    for (let index = 0; index < WorkspaceTabPolicy.maxOpenTabs; index += 1) {
      await expect(store.openTab({
        ...main, requestId: `n-${index}`, expectedRevision: rev(), pageId: 'sample.multi', newInstance: true
      })).resolves.toMatchObject({ status: 'applied' })
    }
    await expect(store.openTab({ ...main, requestId: 'n-over', expectedRevision: rev(), pageId: 'sample.multi', newInstance: true }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'limit-reached' })
    expect(store.getSnapshot().tabs).toHaveLength(WorkspaceTabPolicy.maxOpenTabs)
    expect(store.getSnapshot().tabs.every((tab) => tab.open)).toBe(true)

    // 关闭一个后又能打开：上限只拒绝新开，不清空既有布局
    await store.closeTab({ ...main, requestId: 'n-close', expectedRevision: rev(), workspaceInstanceKey: store.getSnapshot().tabs[0]!.workspaceInstanceKey })
    await expect(store.openTab({ ...main, requestId: 'n-retry', expectedRevision: rev(), pageId: 'sample.multi', newInstance: true }))
      .resolves.toMatchObject({ status: 'applied' })
  })

  it('未注册页面、陈旧 revision 与未 seal 的注册表一律 typed reject', async () => {
    const { store, rev, main } = createStore([registration('sample.alpha')])
    await expect(store.openTab({ ...main, requestId: 'g1', expectedRevision: rev(), pageId: 'sample.unknown' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'registration-missing' })
    await expect(store.openTab({ ...main, requestId: 'g2', expectedRevision: rev() + 1, pageId: 'sample.alpha' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'stale-revision' })
    await expect(store.activateTab({ ...main, requestId: 'g3', expectedRevision: rev(), workspaceInstanceKey: 'workspace-missing' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'registration-missing' })
    await expect(store.closeTab({ ...main, requestId: 'g4', expectedRevision: rev(), workspaceInstanceKey: 'workspace-missing' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'registration-missing' })
    const registry = createWorkspacePageRegistry({ moduleIds: ['sample.alpha'], productIds: ['sample'] })
    expect(() => createWorkspaceTabStore({ pageRegistry: registry })).toThrow()
  })
})

/**
 * P2-04：v2 接回 runtime（Tab 侧）。恢复是主窗专属的一条 CAS 命令；身份一律重生成；
 * 未注册页面/非法键只局部剪裁；最近关闭恢复后为空；单写出口有界且绝不逐出已打开实例。
 */
describe('P2-04 Tab hydrate：v2 → runtime，身份重生成与局部剪裁', () => {
  const pages = [registration('sample.page-a'), registration('sample.page-b', { binding: { persistence: 'session', maxKeyBytes: 256 } })]

  it('按 order 恢复 Tab（顺序/打开态/mode 保真），活动项取自 v2 且 revision +1', async () => {
    const { store, main } = createStore(pages)
    const result = await store._restoreTabs({
      ...main, requestId: 'restore', expectedRevision: 0,
      tabs: [
        { workspaceInstanceKey: 'workspace_b', pageId: 'sample.page-b', open: true, order: 1, mode: 'main' },
        { workspaceInstanceKey: 'workspace_a', pageId: 'sample.page-a', open: true, order: 0, mode: 'detached' }
      ],
      activeWorkspaceInstanceKey: 'workspace_b'
    })
    expect(result).toMatchObject({ status: 'applied', restoredTabs: 2, prunedTabs: 0 })
    const snapshot = store.getSnapshot()
    expect(snapshot.layoutRevision).toBe(1)
    expect(snapshot.tabs.map((tab) => [tab.workspaceInstanceKey, tab.order, tab.mode])).toEqual([
      ['workspace_a', 0, 'detached'], ['workspace_b', 1, 'main']
    ])
    expect(snapshot.activeWorkspaceInstanceKey).toBe('workspace_b')
    // 身份重生成：detached 不再是主窗哨兵，且 epoch 抬升
    const detached = snapshot.tabs[0]!
    expect(detached.windowInstanceId).not.toBe('main')
    expect(detached.hostEpoch).toBe(2)
    expect(snapshot.tabs[1]?.windowInstanceId).toBe('main')
  })

  it('Tab 一律不带 binding：session 页面恢复后 bindingState=unavailable，等宿主重新补绑', async () => {
    const { store, main } = createStore(pages)
    await store._restoreTabs({
      ...main, requestId: 'restore', expectedRevision: 0,
      tabs: [{ workspaceInstanceKey: 'workspace_b', pageId: 'sample.page-b', open: true, order: 0, mode: 'main' }],
      activeWorkspaceInstanceKey: 'workspace_b'
    })
    expect(store.getSnapshot().tabs[0]?.bindingState).toBe('unavailable')
    expect(JSON.stringify(store.getSnapshot())).not.toMatch(/session-leftover|bindingKey/)
  })

  it('未注册页面 / 重复键 / 非法键 / 非法 order 只剪掉该条并计数，其余布局照常恢复', async () => {
    const { store, main } = createStore(pages)
    const result = await store._restoreTabs({
      ...main, requestId: 'restore', expectedRevision: 0,
      tabs: [
        { workspaceInstanceKey: 'workspace_a', pageId: 'sample.page-a', open: true, order: 0, mode: 'main' },
        { workspaceInstanceKey: 'workspace_gone', pageId: 'sample.uninstalled', open: true, order: 1, mode: 'main' },
        { workspaceInstanceKey: 'workspace_a', pageId: 'sample.page-b', open: true, order: 2, mode: 'main' },
        { workspaceInstanceKey: `bad${String.fromCharCode(1)}key`, pageId: 'sample.page-b', open: true, order: 3, mode: 'main' },
        { workspaceInstanceKey: 'workspace_bad_order', pageId: 'sample.page-b', open: true, order: -1, mode: 'main' }
      ],
      activeWorkspaceInstanceKey: 'workspace_gone'
    })
    expect(result).toMatchObject({ status: 'applied', restoredTabs: 1, prunedTabs: 4 })
    expect(store.getSnapshot().tabs.map((tab) => tab.workspaceInstanceKey)).toEqual(['workspace_a'])
    // 活动项落到被剪掉的 tab 上 ⇒ 回退到仍打开的 tab，绝不悬空
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBe('workspace_a')
  })

  it('显式关闭（open=false）恢复为关闭：绝不自动重开，且最近关闭历史为空', async () => {
    const { store, main } = createStore(pages)
    const result = await store._restoreTabs({
      ...main, requestId: 'restore', expectedRevision: 0,
      tabs: [
        { workspaceInstanceKey: 'workspace_a', pageId: 'sample.page-a', open: false, order: 0, mode: 'main' },
        { workspaceInstanceKey: 'workspace_b', pageId: 'sample.page-b', open: true, order: 1, mode: 'main' }
      ],
      activeWorkspaceInstanceKey: 'workspace_a'
    })
    expect(result.status).toBe('applied')
    expect(store.getSnapshot().tabs[0]?.open).toBe(false)
    expect(store.recentlyClosed()).toEqual([]) // §7：重启后「最近关闭」为空
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBe('workspace_b')
  })

  it('CAS 与所有权 fail closed：陈旧 revision 拒绝、非主窗拒绝，且都不改状态', async () => {
    const { store, main } = createStore(pages)
    const stale = await store._restoreTabs({
      ...main, requestId: 'stale', expectedRevision: 5,
      tabs: [{ workspaceInstanceKey: 'workspace_a', pageId: 'sample.page-a', open: true, order: 0, mode: 'main' }],
      activeWorkspaceInstanceKey: 'workspace_a'
    })
    expect(stale).toMatchObject({ status: 'rejected', errorCode: 'stale-revision' })
    const foreign = await store._restoreTabs({
      requestScope: 'other', windowInstanceId: 'window-9', hostEpoch: 4, requestId: 'foreign', expectedRevision: 0,
      tabs: [{ workspaceInstanceKey: 'workspace_a', pageId: 'sample.page-a', open: true, order: 0, mode: 'main' }],
      activeWorkspaceInstanceKey: 'workspace_a'
    })
    expect(foreign).toMatchObject({ status: 'rejected', errorCode: 'not-owner' })
    expect(store.getSnapshot().tabs).toEqual([])
    expect(store.getSnapshot().layoutRevision).toBe(0)
  })
})

describe('P2-04 Tab 单写出口（exportLayoutTabs）有界', () => {
  it('打开的 tab 全部保留（顺序不变）+ order 致密化', async () => {
    const { store, main } = createStore([registration('sample.page-a', { allowMultipleInstances: true })])
    await store.openTab({ ...main, requestId: 'open-1', expectedRevision: 0, pageId: 'sample.page-a' })
    await store.openTab({ ...main, requestId: 'open-2', expectedRevision: 1, pageId: 'sample.page-a', newInstance: true })
    const exported = store.exportLayoutTabs()
    expect(exported.droppedTabs).toBe(0)
    expect(exported.tabs.map((tab) => tab.order)).toEqual([0, 1])
    expect(exported.tabs.every((tab) => tab.open)).toBe(true)
  })

  it('关闭记录按「最近关闭优先」保留，且超出上限时只截掉关闭记录，绝不逐出打开实例', async () => {
    const { store, main } = createStore([registration('sample.page-a', { allowMultipleInstances: true })])
    let revision = 0
    const keys: string[] = []
    for (let index = 0; index < WorkspaceTabPolicy.maxOpenTabs + 3; index += 1) {
      const opened = await store.openTab({ ...main, requestId: `open-${index}`, expectedRevision: revision, pageId: 'sample.page-a', newInstance: true })
      if (typeof opened.workspaceInstanceKey !== 'string') throw new Error('open failed')
      keys.push(opened.workspaceInstanceKey)
      revision = opened.snapshot.layoutRevision
      const closed = await store.closeTab({ ...main, requestId: `close-${index}`, expectedRevision: revision, workspaceInstanceKey: opened.workspaceInstanceKey })
      revision = closed.snapshot.layoutRevision
    }
    const exported = store.exportLayoutTabs()
    expect(exported.tabs.length).toBeLessThanOrEqual(WorkspaceTabPolicy.maxOpenTabs)
    expect(exported.droppedTabs).toBe(3)
    // 最近关闭（最后一次）一定在导出里
    expect(exported.tabs[0]?.workspaceInstanceKey).toBe(keys.at(-1))
    expect(exported.tabs.every((tab) => tab.order === exported.tabs.indexOf(tab))).toBe(true)

    // 打开一个 tab 后：打开项永不被截断
    const reopened = await store.openTab({ ...main, requestId: 'reopen', expectedRevision: revision, pageId: 'sample.page-a' })
    expect(reopened.status).toBe('applied')
    const afterExport = store.exportLayoutTabs()
    expect(afterExport.tabs.filter((tab) => tab.open)).toHaveLength(1)
  })
})
