import { describe, expect, it } from 'vitest'

import { createPanelRegistry } from '../registry/panelRegistry'
import { createPanelWorkspaceStore } from './panelWorkspaceStore'
import { createWorkspaceTransferCoordinator } from './workspaceTransfer'

function fixture() {
  const registry = createPanelRegistry({ pageIds: ['sample.page'], moduleIds: ['sample.inspector'] })
  registry.register({
    panelId: 'sample.inspector', title: { 'zh-CN': '检查器', 'en-US': 'Inspector' }, icon: 'file-text', module: 'sample.inspector', pageIds: ['sample.page'],
    supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'], defaultMode: 'embedded', allowMultipleInstances: false,
    minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 }, binding: { persistence: 'none', maxKeyBytes: 256 }, lifecycleEvents: ['open', 'close']
  })
  registry.seal()
  let clock = 0
  let counter = 0
  const store = createPanelWorkspaceStore({
    panelRegistry: registry, pageIds: ['sample.page'], now: () => clock,
    createOpaqueId: (prefix = 'id') => `${prefix}_00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
  })
  return { store, transfer: createWorkspaceTransferCoordinator(store), advance: (ms: number) => { clock += ms } }
}

async function opened() {
  const context = fixture()
  const workspace = await context.store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page' })
  const panel = await context.store.openPanel({ requestId: 'panel', expectedRevision: 1, hostEpoch: 1, windowInstanceId: 'main', workspaceInstanceKey: workspace.workspaceInstanceKey, panelId: 'sample.inspector' })
  return { ...context, panel }
}

async function beginDetached(context: Awaited<ReturnType<typeof opened>>) {
  const result = await context.transfer.begin({ requestId: 'detach', requestScope: 'main', expectedRevision: 2, hostEpoch: 1, windowInstanceId: 'main', panelInstanceKey: context.panel.panelInstanceKey, targetMode: 'detached' })
  if (result.status !== 'preparing') throw new Error(`expected preparing, got ${result.status}`)
  return result
}

describe('workspace transfer coordinator', () => {
  it('requires source prepared before target ready and commits only after source release', async () => {
    const context = await opened(); const began = await beginDetached(context)
    await expect(context.transfer.targetReady({ operationId: began.operation.operationId, host: began.operation.target })).resolves.toEqual({ accepted: false })
    await expect(context.transfer.sourcePrepared({ operationId: began.operation.operationId, host: began.operation.source, result: { status: 'ready' } })).resolves.toEqual({ accepted: true })
    await expect(context.transfer.targetReady({ operationId: began.operation.operationId, host: { ...began.operation.target, hostEpoch: 99 } })).resolves.toEqual({ accepted: false })
    await expect(context.transfer.targetReady({ operationId: began.operation.operationId, host: began.operation.target })).resolves.toEqual({ accepted: true })
    await expect(context.transfer.sourceReleased({ operationId: began.operation.operationId, host: began.operation.source })).resolves.toEqual({ accepted: true })
    expect(context.store.getSnapshot().panels[0]).toMatchObject({ mode: 'embedded', transfer: { phase: 'awaiting-commit' } })
    await expect(context.transfer.commit(began.operation.operationId)).resolves.toEqual({ accepted: true })
    expect(context.store.getSnapshot().panels[0]).toMatchObject({ mode: 'detached', windowInstanceId: began.operation.target.windowInstanceId })
  })

  it('rolls back immediately on handoff-required and rejects late callbacks', async () => {
    const context = await opened(); const began = await beginDetached(context)
    await expect(context.transfer.sourcePrepared({ operationId: began.operation.operationId, host: began.operation.source, result: { status: 'handoff-required', reason: 'unsaved-content' } })).resolves.toEqual({ accepted: false })
    expect(context.store.getSnapshot().panels[0]).toMatchObject({ mode: 'embedded', windowInstanceId: 'main' })
    await expect(context.transfer.targetReady({ operationId: began.operation.operationId, host: began.operation.target })).resolves.toEqual({ accepted: false })
  })

  it('rolls back only after the named deadline, preserving the source host', async () => {
    const context = await opened(); const began = await beginDetached(context)
    await expect(context.transfer.expire(began.operation.operationId)).resolves.toEqual({ accepted: false })
    context.advance(10_001)
    await expect(context.transfer.expire(began.operation.operationId)).resolves.toEqual({ accepted: true })
    expect(context.store.getSnapshot().panels[0]).toMatchObject({ mode: 'embedded', windowInstanceId: 'main' })
  })

  it('rolls back when the source release does not reach the separate commit phase', async () => {
    const context = await opened(); const began = await beginDetached(context)
    await context.transfer.sourcePrepared({ operationId: began.operation.operationId, host: began.operation.source, result: { status: 'ready' } })
    await context.transfer.targetReady({ operationId: began.operation.operationId, host: began.operation.target })
    await context.transfer.sourceReleased({ operationId: began.operation.operationId, host: began.operation.source })
    context.advance(2_001)

    await expect(context.transfer.expire(began.operation.operationId)).resolves.toEqual({ accepted: true })
    expect(context.store.getSnapshot().panels[0]).toMatchObject({ mode: 'embedded', windowInstanceId: 'main' })
  })

  it('cancels pending transfer on close and app exit while preserving open state at exit', async () => {
    const context = await opened(); const began = await beginDetached(context)
    await context.store.closePanel({ requestId: 'close', expectedRevision: 3, hostEpoch: 1, windowInstanceId: 'main', panelInstanceKey: context.panel.panelInstanceKey })
    await expect(context.transfer.targetReady({ operationId: began.operation.operationId, host: began.operation.target })).resolves.toEqual({ accepted: false })
    const second = await opened(); const pending = await beginDetached(second)
    const shutdown = await second.store.prepareForAppExit()
    expect(shutdown.panels[0]).toMatchObject({ open: true })
    await expect(second.transfer.sourceReleased({ operationId: pending.operation.operationId, host: pending.operation.source })).resolves.toEqual({ accepted: false })
  })

  it('redocks from a detached host only through the detached sender and commit', async () => {
    const context = await opened()
    const detached = await beginDetached(context)
    await context.transfer.sourcePrepared({ operationId: detached.operation.operationId, host: detached.operation.source, result: { status: 'ready' } })
    await context.transfer.targetReady({ operationId: detached.operation.operationId, host: detached.operation.target })
    await context.transfer.sourceReleased({ operationId: detached.operation.operationId, host: detached.operation.source })
    await context.transfer.commit(detached.operation.operationId)
    const moved = context.store.getSnapshot().panels[0]
    const redock = await context.transfer.begin({ requestId: 'redock', requestScope: 'detached', expectedRevision: context.store.getSnapshot().layoutRevision,
      hostEpoch: moved.hostEpoch, windowInstanceId: moved.windowInstanceId ?? '', panelInstanceKey: moved.panelInstanceKey, targetMode: 'docked-right' })
    if (redock.status !== 'preparing') throw new Error('expected redock preparation')
    expect(redock.operation.target).toEqual({ windowInstanceId: 'main', hostEpoch: 1 })
    await context.transfer.sourcePrepared({ operationId: redock.operation.operationId, host: redock.operation.source, result: { status: 'ready' } })
    await context.transfer.targetReady({ operationId: redock.operation.operationId, host: redock.operation.target })
    await context.transfer.sourceReleased({ operationId: redock.operation.operationId, host: redock.operation.source })
    await context.transfer.commit(redock.operation.operationId)
    expect(context.store.getSnapshot().panels[0]).toMatchObject({ mode: 'docked-right', windowInstanceId: 'main', hostEpoch: 1 })
    expect(context.store.getSnapshot().pageLayouts[0]?.activePanels).toEqual({ 'docked-right': moved.panelInstanceKey })
  })
})
