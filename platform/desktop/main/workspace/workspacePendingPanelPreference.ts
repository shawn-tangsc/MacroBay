import type { WorkspaceEvent, WorkspacePanelSnapshot } from '@platform/workspace/contracts'
import { ownsPanel } from './panelWorkspaceScopeProjection'
import type { WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（**PLAT-31**；PLAT-30 行数纪律：从偏好 producer 抽出的一块）。
 *
 * 「准备期面板目标窗」的**按 registry 定向**受众与投递：
 *  - 受众判据只来自共享 registry + 权威快照：`kind:'detached-panel'` ∧ 已绑定 webContents ∧ 该面板有
 *    in-flight transfer ∧ 面板**尚未归属**这个窗（已归属 ⇒ 交给既有 `router.publish` 归属链）；
 *  - 投递**不经过** `router.publish` ⇒ 主窗与无关窗 0 条、P1 相位零触碰（只读事件）；
 *  - 事件仍是既有 `snapshot` 词汇、面板级 scope、`layoutRevision` 用面板 store 真值；同一窗口身份至多一条。
 */
export type WorkspacePreferencePendingPanelTarget = {
  windowInstanceId: string
  hostEpoch: number
  webContentsId: number
  workspaceInstanceKey: string
  panelInstanceKey: string
}

/** 准备期目标窗的受众投影（纯函数）。与已提交宿主互斥（`ownsPanel` 为真的一律排除）。 */
export function listPendingPanelTargets(
  windowRegistry: WorkspaceWindowRegistry,
  snapshot: { panels: readonly WorkspacePanelSnapshot[] }
): readonly WorkspacePreferencePendingPanelTarget[] {
  return windowRegistry.listDetachedHosts().flatMap((record) => {
    if (record.kind !== 'detached-panel' || record.webContentsId === null || record.panelInstanceKey === null) return []
    const panel = snapshot.panels.find((entry) => entry.panelInstanceKey === record.panelInstanceKey)
    if (panel === undefined || panel.transfer === undefined) return []
    if (ownsPanel(record, panel)) return []
    return [{
      windowInstanceId: record.windowInstanceId,
      hostEpoch: record.hostEpoch,
      webContentsId: record.webContentsId,
      workspaceInstanceKey: panel.workspaceInstanceKey,
      panelInstanceKey: panel.panelInstanceKey
    }]
  })
}

/**
 * 定向投递（同一窗口身份至多一条；单条失败绝不中断其它投递）。返回实际投递数，便于取证。
 * `layoutRevision` 必须是**面板 store** 的真实 revision（绝不用 Tab 的冒充）。
 */
export function deliverPendingPanelPreference(input: {
  targets: readonly WorkspacePreferencePendingPanelTarget[]
  layoutRevision: number
  sendDirected?: (webContentsId: number, event: WorkspaceEvent) => unknown
}): number {
  if (input.sendDirected === undefined) return 0
  const byWindow = new Map<string, WorkspacePreferencePendingPanelTarget>()
  for (const target of input.targets) {
    if (target.webContentsId === null || target.panelInstanceKey.length === 0) continue
    byWindow.set(target.windowInstanceId, target)
  }
  let delivered = 0
  for (const target of byWindow.values()) {
    const event: WorkspaceEvent = Object.freeze({
      type: 'snapshot',
      layoutRevision: input.layoutRevision,
      scope: Object.freeze({
        workspaceInstanceKey: target.workspaceInstanceKey,
        panelInstanceKey: target.panelInstanceKey
      })
    })
    try {
      input.sendDirected(target.webContentsId, event)
      delivered += 1
    } catch { /* 通知失败绝不影响本次受控读取的结论 */ }
  }
  return delivered
}
