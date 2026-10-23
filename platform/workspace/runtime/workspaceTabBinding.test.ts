import { describe, expect, it } from 'vitest'

import type { WorkspacePageRegistration } from '../contracts'
import { createWorkspacePageRegistry } from '../registry/workspacePageRegistry'
import { createWorkspaceTabStore } from './workspaceTabStore'

/**
 * P2-01 focused：Tab 绑定（技术设计 §3.5 / A-T07 的 runtime 部分）。
 * 判据：bind 原地恢复不增实例、session/durable 语义不被放宽、binding key 绝不进入快照、越权/非法键 fail closed。
 */

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
    binding: { persistence: 'session', maxKeyBytes: 32 },
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
  return { store, rev: () => store.getSnapshot().layoutRevision, main: { requestScope: 'main', hostEpoch: 1 } as const }
}

describe('workspace tab binding：原地恢复不增实例', () => {
  it('session 绑定先以 unavailable 壳恢复，bindTab 原地补绑定且不新增实例', async () => {
    const { store, rev, main } = createStore([registration('sample.alpha')])
    const opened = await store.openTab({ ...main, requestId: 'b1', expectedRevision: rev(), pageId: 'sample.alpha' })
    const key = opened.workspaceInstanceKey as string
    expect(store.getSnapshot().tabs).toHaveLength(1)
    expect(store.getSnapshot().tabs[0]?.bindingState).toBe('unavailable')

    const bound = await store.bindTab({ ...main, requestId: 'b2', expectedRevision: rev(), workspaceInstanceKey: key, bindingKey: 'acct-1' })
    expect(bound.status).toBe('applied')
    expect(store.getSnapshot().tabs).toHaveLength(1)
    expect(store.getSnapshot().tabs[0]).toMatchObject({ workspaceInstanceKey: key, bindingState: 'bound', open: true })

    // 绑定后按同一 key 打开：聚焦既有实例（幂等），绝不重复挂载
    const again = await store.openTab({ ...main, requestId: 'b3', expectedRevision: rev(), pageId: 'sample.alpha', bindingKey: 'acct-1' })
    expect(again.workspaceInstanceKey).toBe(key)
    expect(store.getSnapshot().tabs).toHaveLength(1)

    // 换绑仍原地：同一实例键、仍只有一个实例
    await expect(store.bindTab({ ...main, requestId: 'b4', expectedRevision: rev(), workspaceInstanceKey: key, bindingKey: 'acct-2' }))
      .resolves.toMatchObject({ status: 'applied' })
    expect(store.getSnapshot().tabs).toHaveLength(1)
    expect(store.getSnapshot().tabs[0]?.workspaceInstanceKey).toBe(key)
  })

  it('durable 绑定键不进入任何快照或最近关闭视图', async () => {
    const { store, rev, main } = createStore([
      registration('sample.alpha', { binding: { persistence: 'durable', maxKeyBytes: 64 } })
    ])
    const opened = await store.openTab({ ...main, requestId: 'd1', expectedRevision: rev(), pageId: 'sample.alpha' })
    const key = opened.workspaceInstanceKey as string
    await store.bindTab({ ...main, requestId: 'd2', expectedRevision: rev(), workspaceInstanceKey: key, bindingKey: 'durable-secret-key' })

    expect(store.getSnapshot().tabs[0]?.bindingState).toBe('bound')
    expect(JSON.stringify(store.getSnapshot())).not.toContain('durable-secret-key')
    await store.closeTab({ ...main, requestId: 'd3', expectedRevision: rev(), workspaceInstanceKey: key })
    expect(JSON.stringify(store.recentlyClosed())).not.toContain('durable-secret-key')
    // 原地恢复仍是同一个实例键（ID 不编码 key）
    const reopened = await store.reopenLastClosed({ ...main, requestId: 'd4', expectedRevision: rev() })
    expect(reopened.workspaceInstanceKey).toBe(key)
    expect(reopened.workspaceInstanceKey).not.toContain('durable-secret-key')
  })

  it('多实例页面上不同 key 各自独立绑定，互不串页', async () => {
    const { store, rev, main } = createStore([
      registration('sample.multi', { allowMultipleInstances: true, binding: { persistence: 'session', maxKeyBytes: 64 } })
    ])
    const first = await store.openTab({ ...main, requestId: 'k1', expectedRevision: rev(), pageId: 'sample.multi', bindingKey: 'acct-a' })
    const second = await store.openTab({ ...main, requestId: 'k2', expectedRevision: rev(), pageId: 'sample.multi', bindingKey: 'acct-b' })

    expect(second.workspaceInstanceKey).not.toBe(first.workspaceInstanceKey)
    expect(store.getSnapshot().tabs.map((tab) => tab.bindingState)).toEqual(['bound', 'bound'])
    const focusA = await store.openTab({ ...main, requestId: 'k3', expectedRevision: rev(), pageId: 'sample.multi', bindingKey: 'acct-a' })
    expect(focusA.workspaceInstanceKey).toBe(first.workspaceInstanceKey)
    expect(store.getSnapshot().tabs).toHaveLength(2)
    expect(store.getSnapshot().activeWorkspaceInstanceKey).toBe(first.workspaceInstanceKey)
  })
})

describe('workspace tab binding：拒绝路径', () => {
  it('none 绑定的页面不得携带 bindingKey；空键/超长键/控制字符一律 invalid-request', async () => {
    const { store, rev, main } = createStore([
      registration('sample.none', { binding: { persistence: 'none', maxKeyBytes: 32 } }),
      registration('sample.alpha')
    ])
    await expect(store.openTab({ ...main, requestId: 'n1', expectedRevision: rev(), pageId: 'sample.none', bindingKey: 'acct-1' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    await expect(store.openTab({ ...main, requestId: 'n2', expectedRevision: rev(), pageId: 'sample.alpha', bindingKey: '' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    await expect(store.openTab({ ...main, requestId: 'n3', expectedRevision: rev(), pageId: 'sample.alpha', bindingKey: 'x'.repeat(33) }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    await expect(store.openTab({ ...main, requestId: 'n4', expectedRevision: rev(), pageId: 'sample.alpha', bindingKey: 'bad\u0000key' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    expect(store.getSnapshot().tabs).toEqual([])

    const opened = await store.openTab({ ...main, requestId: 'n5', expectedRevision: rev(), pageId: 'sample.none' })
    await expect(store.bindTab({
      ...main, requestId: 'n6', expectedRevision: rev(),
      workspaceInstanceKey: opened.workspaceInstanceKey as string, bindingKey: 'acct-1'
    })).resolves.toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
  })

  it('绑定是宿主内容所有权：只有承载该实例的宿主能补绑定，主窗也不得代绑', async () => {
    const { store, rev, main } = createStore([registration('sample.alpha')])
    const opened = await store.openTab({ ...main, requestId: 'o1', expectedRevision: rev(), pageId: 'sample.alpha' })
    const key = opened.workspaceInstanceKey as string
    await store.detachTab({ ...main, requestId: 'o2', expectedRevision: rev(), workspaceInstanceKey: key })
    const detached = store.getSnapshot().tabs[0]
    expect(detached?.mode).toBe('detached')

    // 主窗只有布局管理权，没有 detached 实例的绑定权（§4）
    await expect(store.bindTab({ ...main, requestId: 'o3', expectedRevision: rev(), workspaceInstanceKey: key, bindingKey: 'acct-1' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'not-owner' })
    // 陈旧 epoch 的旧宿主同样拒绝
    await expect(store.bindTab({
      requestId: 'o4', requestScope: 'window-old', expectedRevision: rev(), hostEpoch: 1,
      windowInstanceId: detached?.windowInstanceId ?? 'window-1', workspaceInstanceKey: key, bindingKey: 'acct-1'
    })).resolves.toMatchObject({ status: 'rejected', errorCode: 'not-owner' })
    // 真正的承载宿主可以原地补绑定
    await expect(store.bindTab({
      requestId: 'o5', requestScope: detached?.windowInstanceId, expectedRevision: rev(),
      hostEpoch: detached?.hostEpoch as number, windowInstanceId: detached?.windowInstanceId, workspaceInstanceKey: key, bindingKey: 'acct-1'
    })).resolves.toMatchObject({ status: 'applied' })
    expect(store.getSnapshot().tabs[0]?.bindingState).toBe('bound')

    await expect(store.bindTab({ ...main, requestId: 'o6', expectedRevision: rev() + 1, workspaceInstanceKey: key, bindingKey: 'acct-2' }))
      .resolves.toMatchObject({ status: 'rejected', errorCode: 'stale-revision' })
  })

  it('同 key 同方法的重复请求回放原结果，不同参数的同 key 请求 fail closed', async () => {
    const { store, rev, main } = createStore([registration('sample.alpha')])
    const first = await store.openTab({ ...main, requestId: 'req-1', expectedRevision: rev(), pageId: 'sample.alpha' })
    const replay = await store.openTab({ ...main, requestId: 'req-1', expectedRevision: 0, pageId: 'sample.alpha' })
    expect(replay.workspaceInstanceKey).toBe(first.workspaceInstanceKey)
    expect(store.getSnapshot().tabs).toHaveLength(1)

    const mismatch = await store.openTab({ ...main, requestId: 'req-1', expectedRevision: rev(), pageId: 'sample.alpha', bindingKey: 'acct-1' })
    expect(mismatch.status).toBe('rejected')
    expect(mismatch.errorCode).toBe('invalid-request')
    expect(store.getSnapshot().tabs).toHaveLength(1)
  })
})
