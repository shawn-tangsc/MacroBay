import {
  validatePanelLayoutDocument,
  type PanelLayoutDocumentV1,
  type PanelLayoutRejectionReason
} from './panelLayoutDocument'
import {
  WorkspaceLayoutSchemaVersionV2,
  validateWorkspaceLayoutDocumentV2,
  type StoredTab,
  type WorkspaceLayoutDocumentV2
} from './workspaceLayoutDocument'

/**
 * Owner: platform/workspace/persistence。权威：技术设计 §7（用户明确批准的**唯一** v1→v2 转换例外）。
 *
 * 授权边界（一条都不许扩大）：
 *  - owner = 平台布局；来源 = 已 Accepted 的 v1 文档（`schemaVersion === 1`）；
 *  - 写完 v2 之后**不再旧格式双写**（写路径由 `panelLayoutStore` 唯一提供，且只写 v2）；
 *  - **无其它兼容分支**：这里只有两条读路径，v2 直通 + v1 一次性升级；其余版本一律
 *    `unknown-schema-version`（调用方据此保护原文件、绝不覆写）；
 *  - 不迁移任何产品数据，也不迁移 Tab 的内容绑定（§7 的 v2 类型没有 binding）。
 *
 * 升级映射（逐条可断言）：
 *  - 每个 v1 `workspace` 升为一个 tab，**workspaceInstanceKey 逐字保留**（同 panel ID 升级），
 *    `order` = 原数组下标，`open = true`，`mode = 'main'`（v1 没有页面容器概念）；
 *  - `panels` 逐字保留（panelInstanceKey / dockSize / detachedBounds / lastValidDock / binding 全部不变）；
 *  - `activeWorkspaceInstanceKey`：v1 没有该字段，取第一个 tab（确定性），无 tab 时为 null；
 *  - Tab 不继承 binding（§7），因此升级不会把 session key 带进 v2。
 */

export type WorkspaceLayoutConversionSource = 'v2' | 'v1-upgrade'
export type WorkspaceLayoutConversion =
  | { status: 'ok'; document: WorkspaceLayoutDocumentV2; source: WorkspaceLayoutConversionSource }
  | { status: 'rejected'; reason: PanelLayoutRejectionReason }

/** 纯函数：只重排形状，不做 I/O、不认识注册表、不决定是否落盘。 */
export function upgradePanelLayoutDocumentV1ToV2(document: PanelLayoutDocumentV1): WorkspaceLayoutDocumentV2 {
  const tabs: StoredTab[] = document.workspaces.map((workspace, index) => Object.freeze({
    workspaceInstanceKey: workspace.workspaceInstanceKey,
    pageId: workspace.pageId,
    open: true,
    order: index,
    mode: 'main' as const
  }))
  return {
    schemaVersion: WorkspaceLayoutSchemaVersionV2,
    savedAt: document.savedAt,
    layoutRevision: document.layoutRevision,
    workspaces: document.workspaces,
    panels: document.panels,
    tabs,
    activeWorkspaceInstanceKey: tabs[0]?.workspaceInstanceKey ?? null
  }
}

/**
 * 读阶梯的唯一入口：v2 直通 → v1 一次性升级 → 其它版本 `unknown-schema-version`。
 * 版本判定放在最前，且对抛错 getter fail closed，绝不让未验证内容进入写入路径。
 */
export function convertWorkspaceLayoutDocument(input: unknown): WorkspaceLayoutConversion {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { status: 'rejected', reason: 'not-an-object' }
  }
  let version: unknown
  try {
    version = (input as Record<string, unknown>).schemaVersion
  } catch {
    return { status: 'rejected', reason: 'not-an-object' }
  }
  if (version === WorkspaceLayoutSchemaVersionV2) {
    const validation = validateWorkspaceLayoutDocumentV2(input)
    return validation.status === 'ok'
      ? { status: 'ok', document: validation.document, source: 'v2' }
      : { status: 'rejected', reason: validation.reason }
  }
  if (version === 1) {
    const legacy = validatePanelLayoutDocument(input)
    if (legacy.status === 'rejected') return { status: 'rejected', reason: legacy.reason }
    const upgraded = upgradePanelLayoutDocumentV1ToV2(legacy.document)
    const validation = validateWorkspaceLayoutDocumentV2(upgraded)
    return validation.status === 'ok'
      ? { status: 'ok', document: validation.document, source: 'v1-upgrade' }
      : { status: 'rejected', reason: validation.reason }
  }
  return { status: 'rejected', reason: 'unknown-schema-version' }
}
