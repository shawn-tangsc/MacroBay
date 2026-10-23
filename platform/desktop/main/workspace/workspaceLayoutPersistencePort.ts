import type { PanelLayoutDocumentV1 } from '@platform/workspace/persistence/panelLayoutDocument'
import type { PanelLayoutSaveResult } from '@platform/workspace/persistence/panelLayoutStore'
import {
  buildWorkspaceLayoutDocumentV2,
  dropNonDurableBindingsV2,
  type WorkspaceLayoutDocumentV2
} from '@platform/workspace/persistence/workspaceLayoutDocument'

/**
 * Owner: platform/desktop/main/workspace（**PLAT-35 组**抽取；PLAT-30 行数纪律：compose 改动前先抽走一块）。
 *
 * P2-04 的**单写出口**：把 runtime store 的 v1 面板载荷与 Tab 载荷合成唯一一份 v2 文档（磁盘上唯一的格式，
 * 绝不旧格式双写）；合成失败只跳过本次写入。非 durable 的残留 key 在这里被摘掉（纵深防御）。
 * 语义与抽取前**逐字不变**：文档 revision = 面板/Tab 两条权威 revision 的较大者（每个 store 的 CAS 仍用
 * 自己的 revision），Tab 载荷来自 `exportLayoutTabs()`，活动键来自 Tab 快照。
 */
export type WorkspaceLayoutPersistencePort = {
  pendingWriteCount: () => number
  flush: () => Promise<PanelLayoutSaveResult>
  schedule: (panelDocument: PanelLayoutDocumentV1) => void
}

export function createWorkspaceLayoutPersistencePort(options: {
  layoutStore: {
    pendingWriteCount: () => number
    flush: () => Promise<PanelLayoutSaveResult>
    schedule: (document: WorkspaceLayoutDocumentV2) => void
  }
  tabStore: {
    getSnapshot: () => { layoutRevision: number; activeWorkspaceInstanceKey: string | null }
    exportLayoutTabs: () => { tabs: readonly WorkspaceLayoutDocumentV2['tabs'][number][] }
  }
  panelRegistry: {
    get: (panelId: string) => { binding: { persistence: 'none' | 'session' | 'durable' } } | undefined
  }
}): WorkspaceLayoutPersistencePort {
  return Object.freeze({
    pendingWriteCount: () => options.layoutStore.pendingWriteCount(),
    flush: () => options.layoutStore.flush(),
    schedule: (panelDocument: PanelLayoutDocumentV1): void => {
      const built = buildWorkspaceLayoutDocumentV2({
        savedAt: panelDocument.savedAt,
        layoutRevision: Math.max(panelDocument.layoutRevision, options.tabStore.getSnapshot().layoutRevision),
        panelDocument,
        tabs: options.tabStore.exportLayoutTabs().tabs,
        activeWorkspaceInstanceKey: options.tabStore.getSnapshot().activeWorkspaceInstanceKey
      })
      if (built.status !== 'ok') return
      const bindings = dropNonDurableBindingsV2(
        built.document,
        (panelId) => options.panelRegistry.get(panelId)?.binding.persistence
      )
      options.layoutStore.schedule(bindings.document)
    }
  })
}
