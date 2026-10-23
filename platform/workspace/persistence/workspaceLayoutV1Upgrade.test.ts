import { describe, expect, it } from 'vitest'

import type { PanelLayoutDocumentV1, StoredPanel, StoredWorkspace } from './panelLayoutDocument'
import {
  WorkspaceLayoutSchemaVersionV2,
  buildWorkspaceLayoutDocumentV2,
  documentByteSizeV2,
  dropNonDurableBindingsV2,
  emptyWorkspaceLayoutDocumentV2,
  pruneWorkspaceLayoutDocumentV2,
  serializeWorkspaceLayoutDocumentV2,
  toPanelLayoutDocumentV1,
  validateWorkspaceLayoutDocumentV2,
  type StoredTab,
  type WorkspaceLayoutDocumentV2
} from './workspaceLayoutDocument'
import { convertWorkspaceLayoutDocument, upgradePanelLayoutDocumentV1ToV2 } from './workspaceLayoutV1Upgrade'
import { WorkspaceTabPolicy } from '../policies'

/**
 * Owner: platform/workspace/persistence。权威：技术设计 §7（用户批准的**唯一** v1→v2 转换例外）+ §8 预算。
 * P2-04 RED→GREEN 矩阵：同 panel ID、Tab 顺序/活动项/bounds、none/session/durable、退出 vs 显式关闭、
 * 未知版本不覆写、卸载局部剪裁。绝不 I/O、绝不触碰真实 profile。
 */

function storedWorkspace(overrides: Partial<StoredWorkspace> = {}): StoredWorkspace {
  return {
    workspaceInstanceKey: 'workspace_1', pageId: 'sample.page-a',
    panelOrder: ['panel_1'], activePanels: { embedded: 'panel_1' }, ...overrides
  }
}

function storedPanel(overrides: Partial<StoredPanel> = {}): StoredPanel {
  return {
    panelInstanceKey: 'panel_1', workspaceInstanceKey: 'workspace_1', panelId: 'sample.inspector',
    open: true, mode: 'docked-right', lastValidDock: 'docked-right',
    dockSize: { width: 480, height: 360 }, detachedBounds: { x: 10, y: 20, width: 480, height: 360 }, ...overrides
  }
}

function v1(overrides: Partial<PanelLayoutDocumentV1> = {}): PanelLayoutDocumentV1 {
  return {
    schemaVersion: 1, savedAt: '2026-10-05T00:00:00.000Z', layoutRevision: 7,
    workspaces: [storedWorkspace()], panels: [storedPanel()], ...overrides
  }
}

function reasonOf(input: unknown): string | undefined {
  const result = convertWorkspaceLayoutDocument(input)
  return result.status === 'rejected' ? result.reason : undefined
}

describe('P2-04 v1→v2：同 panel ID 升级与载荷保真', () => {
  it('每个 v1 workspace 升为一个 tab，workspaceInstanceKey 逐字保留，schemaVersion 变为 2', () => {
    const upgraded = upgradePanelLayoutDocumentV1ToV2(v1())
    expect(upgraded.schemaVersion).toBe(WorkspaceLayoutSchemaVersionV2)
    expect(upgraded.tabs).toHaveLength(1)
    expect(upgraded.tabs[0]).toEqual({
      workspaceInstanceKey: 'workspace_1', pageId: 'sample.page-a', open: true, order: 0, mode: 'main'
    })
    expect(validateWorkspaceLayoutDocumentV2(upgraded).status).toBe('ok')
  })

  it('panelInstanceKey / panelId / dockSize / detachedBounds / lastValidDock 逐字不变（绝不重编号）', () => {
    const upgraded = upgradePanelLayoutDocumentV1ToV2(v1())
    expect(upgraded.panels).toEqual(v1().panels)
    expect(upgraded.panels[0]?.panelInstanceKey).toBe('panel_1')
    expect(upgraded.panels[0]?.panelId).toBe('sample.inspector')
    expect(upgraded.panels[0]?.dockSize).toEqual({ width: 480, height: 360 })
    expect(upgraded.panels[0]?.detachedBounds).toEqual({ x: 10, y: 20, width: 480, height: 360 })
    expect(upgraded.panels[0]?.lastValidDock).toBe('docked-right')
    expect(upgraded.workspaces).toEqual(v1().workspaces)
    expect(upgraded.workspaces[0]?.activePanels).toEqual({ embedded: 'panel_1' })
  })

  it('多 workspace：Tab 顺序 = 原数组下标，活动项取第一个 tab（v1 无活动字段，确定性）', () => {
    const document = v1({
      workspaces: [
        storedWorkspace({ workspaceInstanceKey: 'workspace_a', pageId: 'sample.page-a', panelOrder: [], activePanels: {} }),
        storedWorkspace({ workspaceInstanceKey: 'workspace_b', pageId: 'sample.page-b', panelOrder: [], activePanels: {} }),
        storedWorkspace({ workspaceInstanceKey: 'workspace_c', pageId: 'sample.page-c', panelOrder: [], activePanels: {} })
      ],
      panels: []
    })
    const upgraded = upgradePanelLayoutDocumentV1ToV2(document)
    expect(upgraded.tabs.map((tab) => [tab.workspaceInstanceKey, tab.order])).toEqual([['workspace_a', 0], ['workspace_b', 1], ['workspace_c', 2]])
    expect(upgraded.activeWorkspaceInstanceKey).toBe('workspace_a')
    expect(upgraded.tabs.every((tab) => tab.mode === 'main' && tab.open)).toBe(true)
  })

  it('空 v1 文档：升为合法空 v2（无 tab、active 为 null），绝不抛错', () => {
    const upgraded = upgradePanelLayoutDocumentV1ToV2({ schemaVersion: 1, savedAt: '2026-10-05T00:00:00.000Z', layoutRevision: 0, workspaces: [], panels: [] })
    expect(upgraded.tabs).toEqual([])
    expect(upgraded.activeWorkspaceInstanceKey).toBeNull()
    expect(validateWorkspaceLayoutDocumentV2(upgraded).status).toBe('ok')
  })
})

describe('P2-04 v1→v2：绑定语义 none/session/durable', () => {
  it('durable 的 opaque key 保留；Tab 一律不带 binding（§7 无该字段）', () => {
    const upgraded = upgradePanelLayoutDocumentV1ToV2(v1({
      panels: [storedPanel({ binding: { key: 'durable-key-a' } })]
    }))
    expect(upgraded.panels[0]?.binding).toEqual({ key: 'durable-key-a' })
    for (const tab of upgraded.tabs) expect(Object.hasOwn(tab, 'binding')).toBe(false)
    expect(serializeWorkspaceLayoutDocumentV2(upgraded)).not.toMatch(/session|windowInstanceId|hostEpoch/)
  })

  it('session / none 的残留 key 在剪裁阶段被摘掉，durable 不受影响，且计数如实', () => {
    const document = upgradePanelLayoutDocumentV1ToV2(v1({
      panels: [
        storedPanel({ panelInstanceKey: 'panel_durable', panelId: 'sample.durable', binding: { key: 'keep-me' } }),
        storedPanel({ panelInstanceKey: 'panel_session', panelId: 'sample.session', binding: { key: 'session-leftover' } }),
        storedPanel({ panelInstanceKey: 'panel_none', panelId: 'sample.none', binding: { key: 'none-leftover' } })
      ]
    }))
    const persistence: Record<string, 'none' | 'session' | 'durable'> = {
      'sample.durable': 'durable', 'sample.session': 'session', 'sample.none': 'none'
    }
    const dropped = dropNonDurableBindingsV2(document, (panelId) => persistence[panelId])
    expect(dropped.droppedBindings).toBe(2)
    expect(dropped.document.panels.find((panel) => panel.panelId === 'sample.durable')?.binding).toEqual({ key: 'keep-me' })
    expect(dropped.document.panels.find((panel) => panel.panelId === 'sample.session')?.binding).toBeUndefined()
    expect(dropped.document.panels.find((panel) => panel.panelId === 'sample.none')?.binding).toBeUndefined()
    expect(serializeWorkspaceLayoutDocumentV2(dropped.document)).not.toContain('session-leftover')
  })

  it('未注册面板的残留 key 也一并摘掉（持久化语义未知 ⇒ 不保留）', () => {
    const document = upgradePanelLayoutDocumentV1ToV2(v1({ panels: [storedPanel({ binding: { key: 'orphan' } })] }))
    const dropped = dropNonDurableBindingsV2(document, () => undefined)
    expect(dropped.droppedBindings).toBe(1)
    expect(serializeWorkspaceLayoutDocumentV2(dropped.document)).not.toContain('orphan')
  })
})

describe('P2-04 v1→v2：退出 vs 显式关闭', () => {
  const tabs: readonly StoredTab[] = [
    { workspaceInstanceKey: 'workspace_open', pageId: 'sample.page-a', open: true, order: 0, mode: 'detached', detachedBounds: { x: 1, y: 2, width: 800, height: 600 } },
    { workspaceInstanceKey: 'workspace_closed', pageId: 'sample.page-b', open: false, order: 1, mode: 'main' }
  ]

  it('显式关闭（open=false）真的落盘，且不会被「退出」改成打开', () => {
    const built = buildWorkspaceLayoutDocumentV2({
      savedAt: '2026-10-05T01:00:00.000Z', layoutRevision: 9, panelDocument: v1(), tabs,
      activeWorkspaceInstanceKey: 'workspace_open'
    })
    expect(built.status).toBe('ok')
    if (built.status !== 'ok') return
    expect(built.document.tabs.map((tab) => tab.open)).toEqual([true, false])
    // detached tab 的窗口 bounds 是布局数据，不是窗口身份：必须保真
    expect(built.document.tabs[0]?.detachedBounds).toEqual({ x: 1, y: 2, width: 800, height: 600 })
  })

  it('退出路径只落盘权威快照：open 与 mode 原样，绝不写入 windowInstanceId/hostEpoch', () => {
    const built = buildWorkspaceLayoutDocumentV2({
      savedAt: '2026-10-05T02:00:00.000Z', layoutRevision: 11, panelDocument: v1(), tabs,
      activeWorkspaceInstanceKey: 'workspace_open'
    })
    if (built.status !== 'ok') return
    const text = serializeWorkspaceLayoutDocumentV2(built.document)
    expect(built.document.tabs[0]?.open).toBe(true)
    expect(built.document.tabs[0]?.mode).toBe('detached')
    expect(text).not.toMatch(/windowInstanceId|hostEpoch|owner|session/)
  })

  it('活动项落在已关闭/已消失的 tab 上时回退到第一个打开的 tab，没有则 null', () => {
    const fallback = buildWorkspaceLayoutDocumentV2({
      savedAt: '2026-10-05T03:00:00.000Z', layoutRevision: 3, panelDocument: v1({ workspaces: [], panels: [] }), tabs,
      activeWorkspaceInstanceKey: 'workspace_closed'
    })
    if (fallback.status !== 'ok') return
    expect(fallback.document.activeWorkspaceInstanceKey).toBe('workspace_open')

    const none = buildWorkspaceLayoutDocumentV2({
      savedAt: '2026-10-05T03:00:00.000Z', layoutRevision: 3, panelDocument: v1({ workspaces: [], panels: [] }),
      tabs: [tabs[1]!], activeWorkspaceInstanceKey: null
    })
    if (none.status !== 'ok') return
    expect(none.document.activeWorkspaceInstanceKey).toBeNull()
  })

  it('合成出口有界：重复键丢弃并计数，超过 maxOpenTabs 时先保全部打开项、绝不逐出活动实例', () => {
    const duplicated = buildWorkspaceLayoutDocumentV2({
      savedAt: '2026-10-05T04:00:00.000Z', layoutRevision: 1, panelDocument: v1(), tabs: [tabs[0]!, { ...tabs[0]!, open: false, order: 5 }],
      activeWorkspaceInstanceKey: 'workspace_open'
    })
    if (duplicated.status !== 'ok') return
    expect(duplicated.droppedTabs).toBe(1)
    expect(duplicated.document.tabs).toHaveLength(1)

    const many: StoredTab[] = Array.from({ length: WorkspaceTabPolicy.maxOpenTabs + 4 }, (_unused, index) => ({
      workspaceInstanceKey: `workspace_${String(index).padStart(3, '0')}`, pageId: 'sample.page-a',
      open: index < 3, order: index, mode: 'main' as const
    }))
    const capped = buildWorkspaceLayoutDocumentV2({
      savedAt: '2026-10-05T04:00:00.000Z', layoutRevision: 1, panelDocument: v1(), tabs: many,
      activeWorkspaceInstanceKey: 'workspace_000'
    })
    if (capped.status !== 'ok') return
    expect(capped.document.tabs).toHaveLength(WorkspaceTabPolicy.maxOpenTabs)
    expect(capped.document.tabs.filter((tab) => tab.open)).toHaveLength(3)
    expect(capped.document.activeWorkspaceInstanceKey).toBe('workspace_000')
    expect(capped.droppedTabs).toBe(4)
    // 落盘 order 必须致密（0..n-1），否则下次读入的活动项/顺序语义不稳定
    expect(capped.document.tabs.map((tab) => tab.order)).toEqual(Array.from({ length: WorkspaceTabPolicy.maxOpenTabs }, (_unused, index) => index))
  })
})

describe('P2-04 v1→v2：未知版本不得覆写（读阶梯 fail closed）', () => {
  it('v2 直通、v1 一次性升级，并如实报告来源', () => {
    const v2 = emptyWorkspaceLayoutDocumentV2()
    expect(convertWorkspaceLayoutDocument(v2)).toMatchObject({ status: 'ok', source: 'v2' })
    expect(convertWorkspaceLayoutDocument(v1())).toMatchObject({ status: 'ok', source: 'v1-upgrade' })
  })

  it('v3 / 字符串版本 / 缺版本 / 非对象一律拒绝（调用方据此保护原文件）', () => {
    const v2 = emptyWorkspaceLayoutDocumentV2()
    expect(reasonOf({ ...v2, schemaVersion: 3 })).toBe('unknown-schema-version')
    expect(reasonOf({ ...v2, schemaVersion: '2' })).toBe('unknown-schema-version')
    expect(reasonOf({ ...v1(), schemaVersion: undefined })).toBe('unknown-schema-version')
    expect(reasonOf({ ...v2, schemaVersion: null })).toBe('unknown-schema-version')
    expect(reasonOf([])).toBe('not-an-object')
    expect(reasonOf('{"schemaVersion":2}')).toBe('not-an-object')
    expect(reasonOf(null)).toBe('not-an-object')
    expect(reasonOf({ ...v1(), schemaVersion: 1, panels: [{ ...storedPanel(), open: 'yes' }] })).toBe('invalid-field')
    expect(reasonOf({ ...v2, tabs: [{ ...v1Tabs()[0]!, binding: { key: 'smuggled' } }] })).toBe('invalid-field')
  })

  it('抛错 getter 的文档 fail closed，绝不让异常穿透读路径', () => {
    const hostile = { get schemaVersion(): number { throw new Error('boom') } }
    expect(reasonOf(hostile)).toBe('not-an-object')
  })

  it('v1 里已损坏的文档在升级前就被拒（不会把坏面板带进 v2）', () => {
    expect(reasonOf({ ...v1(), panels: [{ ...storedPanel(), panelInstanceKey: '' }] })).toBe('invalid-field')
    expect(reasonOf({ ...v1(), panels: [{ ...storedPanel(), sessionKey: 'leak' }] })).toBe('forbidden-field')
  })
})

function v1Tabs(): readonly StoredTab[] {
  return upgradePanelLayoutDocumentV1ToV2(v1()).tabs
}

describe('P2-04 v1→v2：卸载局部剪裁（绝不整份丢弃或整份保留）', () => {
  function documentWithThree(): WorkspaceLayoutDocumentV2 {
    return upgradePanelLayoutDocumentV1ToV2(v1({
      workspaces: [
        storedWorkspace({ workspaceInstanceKey: 'workspace_keep', pageId: 'sample.page-a', panelOrder: ['panel_keep'], activePanels: { embedded: 'panel_keep' } }),
        storedWorkspace({ workspaceInstanceKey: 'workspace_drop', pageId: 'sample.gone', panelOrder: ['panel_gone'], activePanels: { embedded: 'panel_gone' } })
      ],
      panels: [
        storedPanel({ panelInstanceKey: 'panel_keep', workspaceInstanceKey: 'workspace_keep', panelId: 'sample.inspector' }),
        storedPanel({ panelInstanceKey: 'panel_gone', workspaceInstanceKey: 'workspace_drop', panelId: 'sample.gone-panel' })
      ]
    }))
  }

  it('只剪掉已消失 page/panel 的条目，其余 Tab/面板/布局逐字保留，并如实计数', () => {
    const pruned = pruneWorkspaceLayoutDocumentV2(documentWithThree(), {
      pageIds: new Set(['sample.page-a']), panelIds: new Set(['sample.inspector'])
    })
    expect(pruned.prunedWorkspaces).toBe(1)
    expect(pruned.prunedPanels).toBe(1)
    expect(pruned.prunedTabs).toBe(1)
    expect(pruned.document.workspaces.map((workspace) => workspace.workspaceInstanceKey)).toEqual(['workspace_keep'])
    expect(pruned.document.panels.map((panel) => panel.panelInstanceKey)).toEqual(['panel_keep'])
    expect(pruned.document.tabs.map((tab) => tab.workspaceInstanceKey)).toEqual(['workspace_keep'])
    expect(pruned.document.tabs[0]?.order).toBe(0)
    expect(pruned.document.activeWorkspaceInstanceKey).toBe('workspace_keep')
  })

  it('全部未注册时剪成合法空文档（不是拒绝、也不是保留原样）', () => {
    const pruned = pruneWorkspaceLayoutDocumentV2(documentWithThree(), { pageIds: new Set(), panelIds: new Set() })
    expect(pruned.document.tabs).toEqual([])
    expect(pruned.document.workspaces).toEqual([])
    expect(pruned.document.panels).toEqual([])
    expect(pruned.document.activeWorkspaceInstanceKey).toBeNull()
    expect(validateWorkspaceLayoutDocumentV2(pruned.document).status).toBe('ok')
  })

  it('活动 Tab 被剪掉时收敛到仍打开的 tab（绝不留下悬空活动项）', () => {
    const document = documentWithThree()
    const withActiveOnDropped: WorkspaceLayoutDocumentV2 = {
      ...document,
      tabs: document.tabs.map((tab) => (tab.workspaceInstanceKey === 'workspace_drop' ? { ...tab, open: true } : tab)),
      activeWorkspaceInstanceKey: 'workspace_drop'
    }
    const pruned = pruneWorkspaceLayoutDocumentV2(withActiveOnDropped, { pageIds: new Set(['sample.page-a']), panelIds: new Set(['sample.inspector']) })
    expect(pruned.document.activeWorkspaceInstanceKey).toBe('workspace_keep')
  })

  it('端口投影逐字还原面板载荷；v2 序列化含 tabs，字节预算按整份 v2 计', () => {
    const document = documentWithThree()
    const projection = toPanelLayoutDocumentV1(document)
    expect(projection.schemaVersion).toBe(1)
    expect(projection.workspaces).toEqual(document.workspaces)
    expect(projection.panels).toEqual(document.panels)
    const text = serializeWorkspaceLayoutDocumentV2(document)
    expect(text).toContain('"schemaVersion": 2')
    expect(text).toContain('"tabs"')
    expect(documentByteSizeV2(document)).toBe(Buffer.byteLength(text, 'utf8'))
  })
})
