import { describe, expect, it } from 'vitest'

import type { StoredPanel, StoredWorkspace } from './panelLayoutDocument'
import {
  WorkspaceLayoutSchemaVersionV2,
  buildWorkspaceLayoutDocumentV2,
  validateWorkspaceLayoutDocumentV2,
  type StoredTab
} from './workspaceLayoutDocument'

/**
 * Owner: platform/workspace/persistence（PLAT-04 focused）。权威：技术设计 §7 Storage Plan / §8 Growth Plan
 * 与清单 PLAT-04「畸形/缺失/超出工作区的 bounds ⇒ fail closed 回落到策略默认并在工作区内夹紧」。
 *
 * 语义（本文件即回归门）：
 *  1) `tabs[].detachedBounds` 是**布局数据**：合法即逐字保留（不重编号、不四舍五入、不补字段）；
 *  2) 畸形 bounds（NaN/负数/0/缺字段/null/非对象）**只丢这一个字段**，Tab 本身保留 ⇒ 运行期回落到
 *     `WorkspaceDetachedWindowPolicy` 默认尺寸并在工作区内夹紧，绝不因一个尺寸让整份布局失效；
 *  3) Tab 的**未知键**仍一律拒绝（绝不夹带内容落盘），未知 `schemaVersion` 仍最先判定（保护原文件）。
 */

function storedWorkspace(overrides: Partial<StoredWorkspace> = {}): StoredWorkspace {
  return {
    workspaceInstanceKey: 'workspace_1', pageId: 'sample.page-a',
    panelOrder: [], activePanels: {}, ...overrides
  }
}

function storedPanel(overrides: Partial<StoredPanel> = {}): StoredPanel {
  return {
    panelInstanceKey: 'panel_1', workspaceInstanceKey: 'workspace_1', panelId: 'sample.inspector',
    open: true, mode: 'embedded', lastValidDock: 'embedded', ...overrides
  }
}

function storedTab(overrides: Partial<StoredTab> = {}): StoredTab {
  return { workspaceInstanceKey: 'workspace_1', pageId: 'sample.page-a', open: true, order: 0, mode: 'main', ...overrides }
}

function documentWithTab(tab: unknown): Record<string, unknown> {
  return {
    schemaVersion: WorkspaceLayoutSchemaVersionV2, savedAt: '2026-10-06T00:00:00.000Z', layoutRevision: 3,
    workspaces: [storedWorkspace()], panels: [storedPanel()], tabs: [tab],
    activeWorkspaceInstanceKey: 'workspace_1'
  }
}

/** 用 unknown 入口构造非法文档，避免测试为了类型而 cast。 */
function readBoundsOf(input: unknown): unknown {
  const result = validateWorkspaceLayoutDocumentV2(input)
  return result.status === 'ok' ? result.document.tabs[0]?.detachedBounds : { rejected: result.status === 'rejected' ? result.reason : 'unknown' }
}

describe('PLAT-04 v2 Tab bounds 校验：合法逐字保留，畸形只丢字段', () => {
  it('合法 detachedBounds 逐字保留（x/y/width/height 全部不被改写）', () => {
    const bounds = { x: -12, y: 7, width: 1280, height: 800 }
    expect(readBoundsOf(documentWithTab(storedTab({ mode: 'detached', detachedBounds: bounds })))).toEqual(bounds)
    // 非 detached 的 Tab 同样可以携带 bounds（用户尺寸是布局数据，与当前容器无关）
    expect(readBoundsOf(documentWithTab(storedTab({ detachedBounds: bounds })))).toEqual(bounds)
  })

  it('畸形 bounds 只丢该字段：Tab 保留、文档仍可读（fail closed ⇒ 策略默认 + 工作区夹紧）', () => {
    const malformed: readonly unknown[] = [
      { x: 0, y: 0, width: Number.NaN, height: 800 },
      { x: 0, y: 0, width: -1280, height: 800 },
      { x: 0, y: 0, width: 0, height: 800 },
      { x: 0, y: 0, width: 1280, height: 0 },
      { x: Number.POSITIVE_INFINITY, y: 0, width: 1280, height: 800 },
      { x: 0, y: 0, width: 1280 },
      { x: 0, y: 0, width: '1280', height: 800 },
      null,
      'nope',
      []
    ]
    for (const candidate of malformed) {
      expect(readBoundsOf(documentWithTab({ ...storedTab({ mode: 'detached' }), detachedBounds: candidate }))).toBeUndefined()
    }
    // bounds 子对象里的未知键不夹带落盘（只保留 4 个尺寸项），也绝不因此丢掉 Tab
    expect(readBoundsOf(documentWithTab({ ...storedTab(), detachedBounds: { x: 1, y: 2, width: 800, height: 600, extra: 'x' } })))
      .toEqual({ x: 1, y: 2, width: 800, height: 600 })
    // Tab 本身仍在文档里（只丢字段，绝不整份失效）
    const kept = validateWorkspaceLayoutDocumentV2(documentWithTab({ ...storedTab({ mode: 'detached' }), detachedBounds: null }))
    expect(kept.status).toBe('ok')
    if (kept.status !== 'ok') return
    expect(kept.document.tabs).toHaveLength(1)
    expect(kept.document.tabs[0]?.workspaceInstanceKey).toBe('workspace_1')
  })

  it('Tab 未知键仍一律拒绝；未知 schemaVersion 仍最先判定（绝不进入写入路径）', () => {
    expect(validateWorkspaceLayoutDocumentV2(documentWithTab({ ...storedTab(), binding: { key: 'smuggled' } })).status).toBe('rejected')
    expect(validateWorkspaceLayoutDocumentV2({ ...documentWithTab(storedTab()), schemaVersion: 3 })).toEqual({
      status: 'rejected', reason: 'unknown-schema-version'
    })
  })

  it('单写出口（buildWorkspaceLayoutDocumentV2）逐字保留 bounds，畸形则不带该字段', () => {
    const built = buildWorkspaceLayoutDocumentV2({
      savedAt: '2026-10-06T00:00:00.000Z', layoutRevision: 5,
      panelDocument: {
        schemaVersion: 1, savedAt: '2026-10-06T00:00:00.000Z', layoutRevision: 5,
        workspaces: [storedWorkspace()], panels: [storedPanel()]
      },
      tabs: [storedTab({ mode: 'detached', detachedBounds: { x: 5, y: 6, width: 1000, height: 700 } })],
      activeWorkspaceInstanceKey: 'workspace_1'
    })
    expect(built.status).toBe('ok')
    if (built.status !== 'ok') return
    expect(built.document.tabs[0]?.detachedBounds).toEqual({ x: 5, y: 6, width: 1000, height: 700 })
  })
})
