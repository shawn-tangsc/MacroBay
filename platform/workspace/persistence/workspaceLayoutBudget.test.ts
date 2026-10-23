import { describe, expect, it } from 'vitest'

import {
  WorkspaceLayoutBudgetPolicy,
  documentByteSize,
  emptyPanelLayoutDocument,
  parsePanelLayoutDocument,
  prunePanelLayoutDocument,
  serializePanelLayoutDocument,
  validatePanelLayoutDocument,
  type PanelLayoutDocumentV1,
  type StoredPanel,
  type StoredWorkspace
} from './panelLayoutDocument'
import { WorkspaceRegistrationPolicy } from '../policies'

/**
 * Owner: platform/workspace/persistence。权威：技术设计 §7 Storage Plan / §8 Growth Plan。
 * 只覆盖「文档形状 + 有界预算 + 剪裁 + 解析安全」；真实文件读写与写入合并见 panelLayoutStore.test.ts。
 */

function workspace(overrides: Partial<StoredWorkspace> = {}): StoredWorkspace {
  return { workspaceInstanceKey: 'workspace_1', pageId: 'sample.page-a', panelOrder: ['panel_1'], activePanels: { embedded: 'panel_1' }, ...overrides }
}

function storedPanel(overrides: Partial<StoredPanel> = {}): StoredPanel {
  return {
    panelInstanceKey: 'panel_1', workspaceInstanceKey: 'workspace_1', panelId: 'sample.inspector',
    open: true, mode: 'embedded', lastValidDock: 'embedded', ...overrides
  }
}

function document(overrides: Partial<PanelLayoutDocumentV1> = {}): PanelLayoutDocumentV1 {
  return { schemaVersion: 1, savedAt: '2026-10-05T00:00:00.000Z', layoutRevision: 3, workspaces: [workspace()], panels: [storedPanel()], ...overrides }
}

/** 用 unknown 入口构造非法文档，避免测试为了类型而 cast。 */
function rejectedReason(input: unknown): string | undefined {
  const result = validatePanelLayoutDocument(input)
  return result.status === 'rejected' ? result.reason : undefined
}

describe('panel layout document shape', () => {
  it('starts from an empty document that validates and round-trips', () => {
    const empty = emptyPanelLayoutDocument()
    expect(empty.schemaVersion).toBe(1)
    expect(empty.workspaces).toEqual([])
    expect(empty.panels).toEqual([])
    expect(validatePanelLayoutDocument(empty).status).toBe('ok')

    const parsed = parsePanelLayoutDocument(serializePanelLayoutDocument(document()))
    expect(parsed.status).toBe('ok')
    if (parsed.status !== 'ok') return
    expect(parsed.document.panels[0]?.panelInstanceKey).toBe('panel_1')
    expect(parsed.document.workspaces[0]?.activePanels).toEqual({ embedded: 'panel_1' })
  })

  it('accepts only schemaVersion 1 and reports unknown versions for safe default', () => {
    expect(rejectedReason({ ...document(), schemaVersion: 2 })).toBe('unknown-schema-version')
    expect(rejectedReason({ ...document(), schemaVersion: '1' })).toBe('unknown-schema-version')
    expect(rejectedReason(document())).toBeUndefined()
  })

  it('rejects malformed fields instead of guessing', () => {
    expect(rejectedReason(null)).toBe('not-an-object')
    expect(rejectedReason([document()])).toBe('not-an-object')
    expect(rejectedReason({ ...document(), savedAt: '' })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), layoutRevision: -1 })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), layoutRevision: 1.5 })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), workspaces: 'nope' })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), open: 'yes' }] })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), mode: 'floating' }] })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), lastValidDock: 'detached' }] })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), dockSize: { width: Number.NaN, height: 360 } }] })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), detachedBounds: { x: 0, y: 0, width: 0, height: 360 } }] })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), workspaces: [{ workspaceInstanceKey: 'w', pageId: 'sample.page-a', panelOrder: [], activePanels: { detached: 'panel_1' } }] })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), workspaces: [{ workspaceInstanceKey: 'w', pageId: 'sample.page-a', panelOrder: [7], activePanels: {} }] })).toBe('invalid-field')
  })

  it('never stores owner, session or business payload fields', () => {
    // 文档中不得出现 windowInstanceId/hostEpoch/owner、session、密钥、prompt/查询正文、业务数据
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), windowInstanceId: 'main' }] })).toBe('forbidden-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), hostEpoch: 1 }] })).toBe('forbidden-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), owner: 'main' }] })).toBe('forbidden-field')
    expect(rejectedReason({ ...document(), workspaces: [{ workspaceInstanceKey: 'w', pageId: 'p', panelOrder: [], activePanels: {}, sessionKey: 's' }] })).toBe('forbidden-field')
    expect(rejectedReason({ ...document(), apiKey: 'sk-live' })).toBe('forbidden-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), prompt: 'hello' }] })).toBe('forbidden-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), query: 'select 1' }] })).toBe('forbidden-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), content: { messages: [] } }] })).toBe('forbidden-field')
  })

  it('only accepts safe opaque binding keys', () => {
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), binding: { key: 'durable-key-1' } }] })).toBeUndefined()
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), binding: { key: '' } }] })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), binding: { key: `bad${String.fromCharCode(7)}key` } }] })).toBe('invalid-field')
    // 边界由 WorkspaceRegistrationPolicy.maxBindingKeyBytes 决定（不复制字面量）
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), binding: { key: 'k'.repeat(WorkspaceRegistrationPolicy.maxBindingKeyBytes) } }] })).toBeUndefined()
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), binding: { key: 'k'.repeat(WorkspaceRegistrationPolicy.maxBindingKeyBytes + 1) } }] })).toBe('invalid-field')
    expect(rejectedReason({ ...document(), panels: [{ ...storedPanel(), binding: { key: 'k', extra: 1 } }] })).toBe('invalid-field')
  })
})

describe('workspace layout budget', () => {
  it('names the documented budget instead of scattering literals', () => {
    expect(WorkspaceLayoutBudgetPolicy.maxDocumentBytes).toBe(1_048_576)
    expect(WorkspaceLayoutBudgetPolicy.maxPages).toBe(32)
    expect(WorkspaceLayoutBudgetPolicy.maxPanels).toBe(128)
    expect(WorkspaceLayoutBudgetPolicy.maxRecentClosedInMemory).toBe(10)
    expect(WorkspaceLayoutBudgetPolicy.maxEntryBytes).toBe(4096)
  })

  it('rejects more pages or panels than the budget instead of evicting existing work', () => {
    const pages = Array.from({ length: WorkspaceLayoutBudgetPolicy.maxPages + 1 }, (_, index) => workspace({ workspaceInstanceKey: `workspace_${index}` }))
    expect(rejectedReason({ ...document(), workspaces: pages })).toBe('page-limit-exceeded')

    const panels = Array.from({ length: WorkspaceLayoutBudgetPolicy.maxPanels + 1 }, (_, index) => storedPanel({ panelInstanceKey: `panel_${index}` }))
    expect(rejectedReason({ ...document(), panels })).toBe('panel-limit-exceeded')

    const atLimit = Array.from({ length: WorkspaceLayoutBudgetPolicy.maxPanels }, (_, index) => storedPanel({ panelInstanceKey: `panel_${index}` }))
    expect(rejectedReason({ ...document(), panels: atLimit })).toBeUndefined()
  })

  it('rejects an oversized single entry', () => {
    const hugeOrder = Array.from({ length: 900 }, (_, index) => `panel_with_a_rather_long_name_${index}`)
    expect(rejectedReason({ ...document(), workspaces: [workspace({ panelOrder: hugeOrder })] })).toBe('entry-too-large')
  })

  it('rejects an oversized raw document before parsing it', () => {
    // 非法 JSON 但超过上限：必须是 document-too-large（证明大小判定先于解析）
    const oversizedText = `{"schemaVersion":1,"padding":"${'x'.repeat(WorkspaceLayoutBudgetPolicy.maxDocumentBytes)}"`
    expect(parsePanelLayoutDocument(oversizedText)).toEqual({ status: 'rejected', reason: 'document-too-large' })
    expect(parsePanelLayoutDocument('{')).toEqual({ status: 'rejected', reason: 'not-an-object' })
    expect(parsePanelLayoutDocument('null')).toEqual({ status: 'rejected', reason: 'not-an-object' })
  })

  it('measures the serialized byte size the same way jsonFileStorage writes it', () => {
    const normal = document()
    expect(serializePanelLayoutDocument(normal)).toBe(`${JSON.stringify(normal, null, 2)}\n`)
    expect(documentByteSize(normal)).toBe(Buffer.byteLength(serializePanelLayoutDocument(normal), 'utf8'))
    expect(documentByteSize(normal)).toBeLessThan(4096)
  })

  it('survives ten times the legal input volume without throwing', () => {
    const oversized = {
      ...document(),
      workspaces: Array.from({ length: WorkspaceLayoutBudgetPolicy.maxPages * 10 }, (_, index) => workspace({ workspaceInstanceKey: `workspace_${index}` })),
      panels: Array.from({ length: WorkspaceLayoutBudgetPolicy.maxPanels * 10 }, (_, index) => storedPanel({ panelInstanceKey: `panel_${index}` }))
    }
    expect(() => validatePanelLayoutDocument(oversized)).not.toThrow()
    expect(rejectedReason(oversized)).toBe('page-limit-exceeded')
    expect(parsePanelLayoutDocument('').status).toBe('rejected')
  })
})

describe('unload pruning', () => {
  it('only drops entries whose page or panel disappeared from the registry', () => {
    const kept = document({
      workspaces: [
        workspace({ workspaceInstanceKey: 'workspace_keep', pageId: 'sample.page-a', panelOrder: ['panel_keep', 'panel_gone'], activePanels: { embedded: 'panel_gone' } }),
        workspace({ workspaceInstanceKey: 'workspace_gone', pageId: 'unregistered.page', panelOrder: ['panel_orphan'], activePanels: { embedded: 'panel_orphan' } })
      ],
      panels: [
        storedPanel({ panelInstanceKey: 'panel_keep', workspaceInstanceKey: 'workspace_keep', panelId: 'sample.inspector' }),
        storedPanel({ panelInstanceKey: 'panel_gone', workspaceInstanceKey: 'workspace_keep', panelId: 'unregistered.panel' }),
        storedPanel({ panelInstanceKey: 'panel_orphan', workspaceInstanceKey: 'workspace_gone', panelId: 'sample.inspector' })
      ]
    })
    const pruned = prunePanelLayoutDocument(kept, { pageIds: new Set(['sample.page-a']), panelIds: new Set(['sample.inspector']) })

    expect(pruned.prunedWorkspaces).toBe(1)
    expect(pruned.prunedPanels).toBe(2)
    expect(pruned.document.workspaces.map((entry) => entry.workspaceInstanceKey)).toEqual(['workspace_keep'])
    expect(pruned.document.panels.map((entry) => entry.panelInstanceKey)).toEqual(['panel_keep'])
    // 被剪掉的实例必须同时从 panelOrder / activePanels 移除，其余布局完整保留
    expect(pruned.document.workspaces[0]?.panelOrder).toEqual(['panel_keep'])
    expect(pruned.document.workspaces[0]?.activePanels).toEqual({})
    // 剪裁结果仍然合法
    expect(validatePanelLayoutDocument(pruned.document).status).toBe('ok')
  })
})
