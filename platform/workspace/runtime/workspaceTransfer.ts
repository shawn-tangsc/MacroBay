import type { PanelContainerMode, WorkspaceHost, WorkspacePreparation, WorkspaceSnapshot } from '../contracts'
import type { createPanelWorkspaceStore } from './panelWorkspaceStore'

type Store = ReturnType<typeof createPanelWorkspaceStore>
type TransferBeginInput = { requestId: string; requestScope?: string; expectedRevision: number; hostEpoch: number; windowInstanceId: string; panelInstanceKey: string; targetMode: PanelContainerMode }

export function createWorkspaceTransferCoordinator(store: Store) {
  return Object.freeze({
    begin(input: TransferBeginInput) { return store._beginTransfer(input) },
    sourcePrepared(input: { operationId: string; host: WorkspaceHost; result: WorkspacePreparation }) { return store._sourcePrepared(input.operationId, input.host, input.result.status === 'ready') },
    targetReady(input: { operationId: string; host: WorkspaceHost }) { return store._targetReady(input.operationId, input.host) },
    sourceReleased(input: { operationId: string; host: WorkspaceHost }) { return store._sourceReleased(input.operationId, input.host) },
    commit(operationId: string) { return store._commitTransfer(operationId) },
    expire(operationId: string) { return store._expireTransfer(operationId) },
    snapshot(): WorkspaceSnapshot { return store.getSnapshot() }
  })
}
