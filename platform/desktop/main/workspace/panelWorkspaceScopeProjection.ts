import type {
  PanelContainerMode,
  WorkspaceCommandResult,
  WorkspacePageLayout,
  WorkspacePanelSnapshot,
  WorkspacePendingTransferView,
  WorkspaceSnapshot
} from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
import type { WorkspaceWindowRecord } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace。P1-06c 从 `panelWorkspaceIpcHandlers.ts` 拆出的宿主侧投影：
 * 1) store 身份桥 `toStoreHostIdentity`（主窗 → store 哨兵，其它宿主 → registry 实例身份）与所有权判定
 *    `ownsPanel`；handlers、事件路由目标与 compose 的事务身份贯通共用这一处映射，绝不各自发明身份；
 * 2) `scopeSnapshot`/`emptySnapshot`/`scopeHostMounts`/`projectCommandOutcome`：主窗取全量，独立面板宿主
 *    只拿自己承载的 panels 与其所属 workspace 的 pageLayouts，未授权 sender 只拿空投影（绝不全量回退）；
 * 3) `persistenceState` 一律用真实持久化状态覆盖 store 的硬编码值，revision 始终真实。
 * 本模块是纯函数：不 import electron、不读取 runtime store 内部状态。
 */

export type WorkspaceIpcRejectionCode = NonNullable<WorkspaceCommandResult['errorCode']>
export type WorkspaceIpcRejection = { status: 'rejected'; errorCode: WorkspaceIpcRejectionCode }
export type WorkspaceHostMount = {
  workspaceInstanceKey: string
  panelInstanceKey: string
  panelId: string
  open: boolean
  mode: PanelContainerMode
  bindingState: 'bound' | 'unavailable'
}
export type WorkspaceHostContext = {
  windowInstanceId: string
  hostEpoch: number
  role: 'main' | 'panel'
  mounts: readonly WorkspaceHostMount[]
  /** P1-06f：受控待接管视图（未参与转移的宿主恒为 null）；它不给任何布局权限，只回答「我是不是待接管目标」。 */
  pendingTransfer: WorkspacePendingTransferView | null
  layoutRevision: number
  pageIds: readonly string[]
  preferences: { language: string; theme: string; timeZone: string }
}
export type WorkspaceHostContextOutcome = { status: 'ok'; context: WorkspaceHostContext } | WorkspaceIpcRejection
export type WorkspaceSnapshotOutcome = { status: 'ok'; snapshot: WorkspaceSnapshot } | WorkspaceIpcRejection
export type WorkspaceCommandOutcome = {
  status: 'applied' | 'rejected'
  snapshot: WorkspaceSnapshot
  errorCode?: WorkspaceIpcRejectionCode
  panelInstanceKey?: string
  workspaceInstanceKey?: string
  hostEpoch?: number
}
export type PersistenceStateReader = () => WorkspaceSnapshot['persistenceState']

/**
 * store 身份桥：主窗固定映射到 `WorkspaceOwnershipPolicy.initialWindowInstanceId`（store 的哨兵），
 * 其它宿主用自己的 registry 实例 id。handlers、router 目标、compose 的发送与转移目标共用这一处映射。
 */
export function toStoreHostIdentity(record: WorkspaceWindowRecord): { windowInstanceId: string; hostEpoch: number } {
  return {
    windowInstanceId: record.kind === 'main' ? WorkspaceOwnershipPolicy.initialWindowInstanceId : record.windowInstanceId,
    hostEpoch: record.hostEpoch
  }
}

/**
 * 该宿主当前是否承载这个 panel 实例（快照所有权判定的唯一权威）：
 * - 主窗：快照里的 store 身份必须是 main 哨兵且 hostEpoch 一致；
 * - 独立面板宿主：用 registry 预留时绑定的 `panelInstanceKey` + hostEpoch 判定，不依赖 store 内部自造的
 *   `windowInstanceId`（P1-06c 打通身份前后都不会误授权，也不会漏掉自己的挂载）。
 */
export function ownsPanel(record: WorkspaceWindowRecord, panel: WorkspacePanelSnapshot): boolean {
  if (record.kind === 'main') {
    return panel.windowInstanceId === WorkspaceOwnershipPolicy.initialWindowInstanceId && panel.hostEpoch === record.hostEpoch
  }
  return panel.hostEpoch === record.hostEpoch
    && record.panelInstanceKey !== null && panel.panelInstanceKey === record.panelInstanceKey
}

/**
 * P1-06f：受控待接管视图。判据全部来自 Main（registry 预留 + 权威快照），renderer 无法自造：
 *  - sender 必须是为**这个面板**预留的独立宿主（`kind:'detached-panel'` 且自带 `panelInstanceKey`）；
 *  - 该面板必须真实存在于权威快照里（拿不到 panelId/workspace，就不给视图）；
 *  - 该宿主**尚未取得归属**（`ownsPanel` 为假）：已提交的宿主与 redock 的源宿主都不是「待接管目标」；
 *  - 快照里有飞事务 ⇒ `in-flight`（operationId/相位逐字来自 store）；没有 ⇒ `reserved`（还没有 operationId，
 *    目标窗口据此先渲染准备期界面并等待，而不是把自己当成「没有可承载面板」的错误壳）。
 * 绝不放宽 `mounts`/快照的归属过滤：未参与转移的窗口拿不到任何形状的该视图。
 */
export function pendingTransferFor(raw: WorkspaceSnapshot, record: WorkspaceWindowRecord): WorkspacePendingTransferView | null {
  if (record.kind !== 'detached-panel') return null
  const panelInstanceKey = record.panelInstanceKey
  if (panelInstanceKey === null) return null
  const panel = raw.panels.find((entry) => entry.panelInstanceKey === panelInstanceKey)
  if (panel === undefined || ownsPanel(record, panel)) return null
  const identity = {
    workspaceInstanceKey: panel.workspaceInstanceKey,
    panelInstanceKey: panel.panelInstanceKey,
    panelId: panel.panelId
  }
  return panel.transfer === undefined
    ? Object.freeze({ status: 'reserved' as const, ...identity })
    : Object.freeze({
        status: 'in-flight' as const,
        operationId: panel.transfer.operationId,
        phase: panel.transfer.phase,
        ...identity
      })
}

/** persistenceState 用真实持久化状态覆盖 store 的硬编码值；其余字段原样透传。 */
export function withPersistenceState(raw: WorkspaceSnapshot, readPersistenceState: PersistenceStateReader): WorkspaceSnapshot {
  return { ...raw, persistenceState: readPersistenceState() }
}

/**
 * §4/§8：snapshot 每窗按权限过滤。主窗取全量；独立面板宿主只返回自己承载的 panels 与所属 workspace 的
 * pageLayouts（panelOrder/activePanels 只保留自己的 key，空区域不返回无关条目）；layoutRevision 与
 * persistenceState 始终真实。
 */
export function scopeSnapshot(
  raw: WorkspaceSnapshot,
  record: WorkspaceWindowRecord,
  readPersistenceState: PersistenceStateReader
): WorkspaceSnapshot {
  const snapshot = withPersistenceState(raw, readPersistenceState)
  if (record.kind === 'main') return snapshot
  const panels = snapshot.panels.filter((panel) => ownsPanel(record, panel))
  const panelKeys = new Set(panels.map((panel) => panel.panelInstanceKey))
  const workspaceKeys = new Set(panels.map((panel) => panel.workspaceInstanceKey))
  const pageLayouts = snapshot.pageLayouts
    .filter((layout) => workspaceKeys.has(layout.workspaceInstanceKey))
    .map((layout) => Object.freeze({
      workspaceInstanceKey: layout.workspaceInstanceKey,
      panelOrder: Object.freeze(layout.panelOrder.filter((key) => panelKeys.has(key))),
      activePanels: Object.freeze(Object.fromEntries(
        Object.entries(layout.activePanels).filter(([, key]) => key !== undefined && panelKeys.has(key))
      ))
    }))
  return Object.freeze({
    ...snapshot,
    activeWorkspaceInstanceKey: snapshot.activeWorkspaceInstanceKey !== null
      && workspaceKeys.has(snapshot.activeWorkspaceInstanceKey) ? snapshot.activeWorkspaceInstanceKey : null,
    panels: Object.freeze(panels),
    pageLayouts: Object.freeze(pageLayouts)
  })
}

/** 未授权/未承载任何 panel 的 sender 用的空投影：保留真实 revision 与持久化状态，但绝不含任何布局。 */
export function emptySnapshot(raw: WorkspaceSnapshot, readPersistenceState: PersistenceStateReader): WorkspaceSnapshot {
  return Object.freeze({
    ...withPersistenceState(raw, readPersistenceState),
    activeWorkspaceInstanceKey: null,
    panels: Object.freeze([]) as readonly WorkspacePanelSnapshot[],
    pageLayouts: Object.freeze([]) as readonly WorkspacePageLayout[]
  })
}

/** host context 的挂载列表按同一所有权判定投影；只带安全字段（无 bindingKey/路径/尺寸）。 */
export function scopeHostMounts(raw: WorkspaceSnapshot, record: WorkspaceWindowRecord): readonly WorkspaceHostMount[] {
  return Object.freeze(raw.panels
    .filter((panel) => ownsPanel(record, panel))
    .map((panel) => Object.freeze({
      workspaceInstanceKey: panel.workspaceInstanceKey, panelInstanceKey: panel.panelInstanceKey,
      panelId: panel.panelId, open: panel.open, mode: panel.mode, bindingState: panel.bindingState
    })))
}

/** 命令响应同样按宿主投影；只有 store 真的返回了字段才带上，绝不用 undefined 占位泄露形状。 */
export function projectCommandOutcome(
  result: WorkspaceCommandResult & { panelInstanceKey?: string; workspaceInstanceKey?: string; hostEpoch?: number },
  record: WorkspaceWindowRecord,
  readPersistenceState: PersistenceStateReader
): WorkspaceCommandOutcome {
  return {
    status: result.status,
    snapshot: scopeSnapshot(result.snapshot, record, readPersistenceState),
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    ...(result.panelInstanceKey === undefined ? {} : { panelInstanceKey: result.panelInstanceKey }),
    ...(result.workspaceInstanceKey === undefined ? {} : { workspaceInstanceKey: result.workspaceInstanceKey }),
    ...(result.hostEpoch === undefined ? {} : { hostEpoch: result.hostEpoch })
  }
}
