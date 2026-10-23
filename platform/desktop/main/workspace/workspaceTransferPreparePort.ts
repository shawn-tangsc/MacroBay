import type { WorkspaceCommandResult, WorkspaceHost, WorkspaceSnapshot } from '@platform/workspace/contracts'
import type { createPanelWorkspaceStore } from '@platform/workspace/runtime/panelWorkspaceStore'
import { toStoreHostIdentity } from './panelWorkspaceScopeProjection'
import type { WorkspaceWindowRecord, WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（P2-03，PM 裁决 F2：从 `panelWorkspaceTransferOrchestrator.ts` 拆出）。
 *
 * 事务身份贯通（P1-06c）的**准入**入口：它本来就是「预留身份 → 开飞事务」的转移侧缝合，
 * 与编排器同属一条转移链，因此单独成模块而不是塞回 compose（compose 只做接线）。
 *
 * 行为逐字未改：
 *  - 目标窗口必须由 P1-04 registry **预留**，且必须是 `detached-panel` 且属于同一个面板实例；
 *  - 目标身份经 store 身份桥（`toStoreHostIdentity`）投影后作为 `targetHost` 交给 `_beginTransfer`，
 *    两侧不再各自 `createId`；
 *  - 只做「预留身份 → 开事务」的准入，**不**驱动 ACK/commit、**不**消费 registry 预留（释放归调用方编排）。
 */

/** 事务身份贯通的拒绝原因（与编排器的 `TransferPrepareOutcome.reason` 同一词汇）。 */
export type WorkspaceTransferPrepareRejection =
  | 'unknown-source-window' | 'unknown-target-window' | 'target-not-detached' | 'target-panel-mismatch'
  | 'store-rejected' | 'workspace-disabled'

export type TransferPrepareOutcome =
  | {
      status: 'preparing'
      operationId: string
      source: WorkspaceHost
      target: WorkspaceHost
      /** 预留成功的目标窗口登记记录（完成 attach 前的真实身份来源）。 */
      window: WorkspaceWindowRecord
      snapshot: WorkspaceSnapshot
    }
  | {
      status: 'rejected'
      errorCode: NonNullable<WorkspaceCommandResult['errorCode']>
      reason: WorkspaceTransferPrepareRejection | string
      snapshot: WorkspaceSnapshot
    }

export type TransferPreparePortInput = {
  requestId: string
  expectedRevision: number
  sourceWindowInstanceId: string
  targetWindowInstanceId: string
  panelInstanceKey: string
}

export function createTransferPreparePort(options: {
  runtimeStore: Pick<ReturnType<typeof createPanelWorkspaceStore>, 'getSnapshot' | '_beginTransfer'>
  windowRegistry: Pick<WorkspaceWindowRegistry, 'describeWindow'>
}): (input: TransferPreparePortInput) => Promise<TransferPrepareOutcome> {
  return async (input: TransferPreparePortInput): Promise<TransferPrepareOutcome> => {
    const reject = (
      errorCode: NonNullable<WorkspaceCommandResult['errorCode']>, reason: WorkspaceTransferPrepareRejection
    ): TransferPrepareOutcome =>
      ({ status: 'rejected', errorCode, reason, snapshot: options.runtimeStore.getSnapshot() })
    const sourceRecord = options.windowRegistry.describeWindow(input.sourceWindowInstanceId)
    if (!sourceRecord) return reject('registration-missing', 'unknown-source-window')
    const targetRecord = options.windowRegistry.describeWindow(input.targetWindowInstanceId)
    if (!targetRecord) return reject('registration-missing', 'unknown-target-window')
    if (targetRecord.kind !== 'detached-panel') return reject('not-owner', 'target-not-detached')
    // 只允许把「为这个面板预留」的窗口身份缝进它自己的事务，杜绝把两个不同面板的身份交叉绑定
    if (targetRecord.panelInstanceKey !== input.panelInstanceKey) return reject('not-owner', 'target-panel-mismatch')
    const source = toStoreHostIdentity(sourceRecord)
    const target = toStoreHostIdentity(targetRecord)
    const result = await options.runtimeStore._beginTransfer({
      requestId: input.requestId, requestScope: sourceRecord.windowInstanceId, expectedRevision: input.expectedRevision,
      hostEpoch: source.hostEpoch, windowInstanceId: source.windowInstanceId,
      panelInstanceKey: input.panelInstanceKey, targetMode: 'detached', targetHost: target
    })
    if (result.status !== 'preparing') return reject(result.errorCode ?? 'invalid-request', 'store-rejected')
    return {
      status: 'preparing', operationId: result.operation.operationId,
      source: result.operation.source, target: result.operation.target, window: targetRecord, snapshot: result.snapshot
    }
  }
}
