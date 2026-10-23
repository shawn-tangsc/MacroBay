import { describe, expect, it } from 'vitest'

import { createPanelRegistry } from '../registry/panelRegistry'
import type { PanelContainerMode, WorkspacePanelRegistration } from '../contracts'
import type { PanelLayoutDocumentV1 } from '../persistence/panelLayoutDocument'
import { createPanelWorkspaceStore } from './panelWorkspaceStore'
import { createWorkspaceTransferCoordinator } from './workspaceTransfer'

function panel(overrides: Partial<WorkspacePanelRegistration> = {}): WorkspacePanelRegistration {
  return {
    panelId: 'sample.inspector', title: { 'zh-CN': '检查器', 'en-US': 'Inspector' }, icon: 'file-text',
    module: 'sample.inspector', pageIds: ['sample.page-a', 'sample.page-b'],
    supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'], defaultMode: 'embedded',
    allowMultipleInstances: false, minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 },
    binding: { persistence: 'session', maxKeyBytes: 256 }, lifecycleEvents: ['open', 'close'], ...overrides
  }
}

function fixture(options: { allowMultipleInstances?: boolean; bindingPersistence?: 'none' | 'session' | 'durable'; pageIds?: readonly string[]; supportedModes?: readonly PanelContainerMode[] } = {}) {
  const registry = createPanelRegistry({
    pageIds: ['sample.page-a', 'sample.page-b'], moduleIds: ['sample.inspector']
  })
  registry.register(panel({
    allowMultipleInstances: options.allowMultipleInstances ?? false,
    binding: { persistence: options.bindingPersistence ?? 'session', maxKeyBytes: 256 },
    pageIds: options.pageIds ?? ['sample.page-a', 'sample.page-b'],
    ...(options.supportedModes === undefined ? {} : { supportedModes: options.supportedModes })
  }))
  registry.seal()
  const counters: Record<string, number> = {}
  return createPanelWorkspaceStore({
    panelRegistry: registry,
    pageIds: ['sample.page-a', 'sample.page-b'],
    createOpaqueId: (prefix = 'id') => {
      counters[prefix] = (counters[prefix] ?? 0) + 1
      return `${prefix}_00000000-0000-4000-8000-${String(counters[prefix]).padStart(12, '0')}`
    }
  })
}

describe('panel workspace store', () => {
  it('requires a nonempty trusted page allowlist', () => {
    const registry = createPanelRegistry({ pageIds: ['sample.page-a'], moduleIds: ['sample.inspector'] })
    registry.register(panel({ pageIds: ['sample.page-a'] }))
    registry.seal()

    expect(() => createPanelWorkspaceStore({ panelRegistry: registry, pageIds: [] })).toThrow('workspace page allowlist is required')
  })

  it('keeps same panel IDs isolated by page host and never derives opaque IDs from bindings', async () => {
    const store = fixture()
    const pageA = await store.openWorkspace({ requestId: 'open-a', expectedRevision: 0, pageId: 'sample.page-a' })
    const pageB = await store.openWorkspace({ requestId: 'open-b', expectedRevision: 1, pageId: 'sample.page-b' })
    const first = await store.openPanel({
      requestId: 'panel-a', expectedRevision: 2, hostEpoch: pageA.hostEpoch,
      workspaceInstanceKey: pageA.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'session-key-a'
    })
    const second = await store.openPanel({
      requestId: 'panel-b', expectedRevision: 3, hostEpoch: pageB.hostEpoch,
      workspaceInstanceKey: pageB.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'session-key-b'
    })

    expect(first.panelInstanceKey).not.toBe(second.panelInstanceKey)
    expect(second.snapshot.panels).toEqual(expect.arrayContaining([
      expect.objectContaining({ panelInstanceKey: first.panelInstanceKey, workspaceInstanceKey: pageA.workspaceInstanceKey }),
      expect.objectContaining({ panelInstanceKey: second.panelInstanceKey, workspaceInstanceKey: pageB.workspaceInstanceKey })
    ]))
    expect(JSON.stringify(second.snapshot)).not.toContain('session-key-a')
    expect(JSON.stringify(second.snapshot)).not.toContain('session-key-b')
    expect(first.panelInstanceKey).not.toContain('session-key-a')
  })

  it('rejects a workspace page outside the trusted page allowlist', async () => {
    const store = fixture()
    const result = await store.openWorkspace({ requestId: 'unknown-page', expectedRevision: 0, pageId: 'not-registered' })
    expect(result).toMatchObject({ status: 'rejected', errorCode: 'registration-missing' })
  })

  it('reuses same binding, permits explicit multi-instance only when registered, and reopens in its original slot', async () => {
    const store = fixture({ allowMultipleInstances: true })
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const opened = await store.openPanel({ requestId: 'first', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'same' })
    const duplicate = await store.openPanel({ requestId: 'duplicate', expectedRevision: 2, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'same' })
    const second = await store.openPanel({ requestId: 'second', expectedRevision: 2, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'same', newInstance: true })
    const closed = await store.closePanel({ requestId: 'close', expectedRevision: 3, hostEpoch: 1, panelInstanceKey: opened.panelInstanceKey })
    const reopened = await store.openPanel({ requestId: 'reopen', expectedRevision: 4, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'same' })

    expect(duplicate.panelInstanceKey).toBe(opened.panelInstanceKey)
    expect(duplicate.snapshot.layoutRevision).toBe(2)
    expect(second.panelInstanceKey).not.toBe(opened.panelInstanceKey)
    expect(closed.snapshot.panels.find((item) => item.panelInstanceKey === opened.panelInstanceKey)).toMatchObject({ open: false })
    expect(reopened.panelInstanceKey).toBe(opened.panelInstanceKey)
    expect(reopened.snapshot.pageLayouts[0]?.panelOrder).toEqual([opened.panelInstanceKey, second.panelInstanceKey])
  })

  it('binds an unavailable session panel in place and rejects stale revision or host epoch', async () => {
    const store = fixture()
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const unbound = await store.openPanel({ requestId: 'unbound', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector' })
    const bound = await store.bindPanel({ requestId: 'bind', expectedRevision: 2, hostEpoch: 1, panelInstanceKey: unbound.panelInstanceKey, bindingKey: 'restored-session' })
    const stale = await store.activatePanel({ requestId: 'stale', expectedRevision: 1, hostEpoch: 1, panelInstanceKey: unbound.panelInstanceKey })
    const oldHost = await store.activatePanel({ requestId: 'old-host', expectedRevision: 3, hostEpoch: 0, panelInstanceKey: unbound.panelInstanceKey })

    expect(unbound.snapshot.panels[0]).toMatchObject({ bindingState: 'unavailable' })
    expect(bound.panelInstanceKey).toBe(unbound.panelInstanceKey)
    expect(bound.snapshot.panels[0]).toMatchObject({ bindingState: 'bound' })
    expect(JSON.stringify(bound.snapshot)).not.toContain('restored-session')
    expect(stale).toMatchObject({ status: 'rejected', errorCode: 'stale-revision' })
    expect(oldHost).toMatchObject({ status: 'rejected', errorCode: 'not-owner' })
  })

  it('authorizes a panel by page, treats binding-none as bound, and records the active slot', async () => {
    const store = fixture({ bindingPersistence: 'none', pageIds: ['sample.page-a'] })
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const opened = await store.openPanel({ requestId: 'panel', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector' })
    const forbiddenPage = await store.openWorkspace({ requestId: 'other-page', expectedRevision: 2, pageId: 'sample.page-b' })
    const rejected = await store.openPanel({ requestId: 'forbidden', expectedRevision: 3, hostEpoch: 1,
      workspaceInstanceKey: forbiddenPage.workspaceInstanceKey, panelId: 'sample.inspector' })
    const explicitBinding = await store.openPanel({ requestId: 'explicit-binding', expectedRevision: 3, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'must-not-be-supplied' })

    expect(opened.snapshot.panels[0]).toMatchObject({ bindingState: 'bound', mode: 'embedded', lastValidDock: 'embedded' })
    expect(opened.snapshot.pageLayouts[0]).toMatchObject({ activePanels: { embedded: opened.panelInstanceKey } })
    expect(rejected).toMatchObject({ status: 'rejected', errorCode: 'registration-missing' })
    expect(explicitBinding).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
  })

  it('tracks activation, keeps a fixed panel order, and selects the next panel after close', async () => {
    const registry = createPanelRegistry({ pageIds: ['sample.page-a'], moduleIds: ['sample.inspector', 'sample.details'] })
    registry.register(panel({ allowMultipleInstances: true, pageIds: ['sample.page-a'] }))
    registry.register(panel({ panelId: 'sample.details', module: 'sample.details', pageIds: ['sample.page-a'], allowMultipleInstances: true }))
    registry.seal()
    const store = createPanelWorkspaceStore({ panelRegistry: registry, pageIds: ['sample.page-a'] })
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const first = await store.openPanel({ requestId: 'first', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector' })
    const second = await store.openPanel({ requestId: 'second', expectedRevision: 2, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.details' })
    const activated = await store.activatePanel({ requestId: 'activate', expectedRevision: 3, hostEpoch: 1, panelInstanceKey: second.panelInstanceKey })
    const closed = await store.closePanel({ requestId: 'close', expectedRevision: 3, hostEpoch: 1, panelInstanceKey: second.panelInstanceKey })

    expect(activated.snapshot.pageLayouts[0]?.panelOrder).toEqual([first.panelInstanceKey, second.panelInstanceKey])
    expect(activated.snapshot.pageLayouts[0]?.activePanels.embedded).toBe(second.panelInstanceKey)
    expect(closed.snapshot.pageLayouts[0]?.activePanels.embedded).toBe(first.panelInstanceKey)
  })

  it('records the workspace containing the panel that is actually activated', async () => {
    const store = fixture()
    const firstWorkspace = await store.openWorkspace({ requestId: 'workspace-a', expectedRevision: 0, pageId: 'sample.page-a' })
    const firstPanel = await store.openPanel({ requestId: 'panel-a', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: firstWorkspace.workspaceInstanceKey, panelId: 'sample.inspector' })
    const secondWorkspace = await store.openWorkspace({ requestId: 'workspace-b', expectedRevision: 2, pageId: 'sample.page-b' })
    await store.openPanel({ requestId: 'panel-b', expectedRevision: 3, hostEpoch: 1,
      workspaceInstanceKey: secondWorkspace.workspaceInstanceKey, panelId: 'sample.inspector' })
    const beforeActivation = store.getSnapshot()
    const activated = await store.activatePanel({ requestId: 'activate-first', expectedRevision: 4, hostEpoch: 1,
      panelInstanceKey: firstPanel.panelInstanceKey })

    expect(activated.snapshot.activeWorkspaceInstanceKey).toBe(firstWorkspace.workspaceInstanceKey)
    expect(activated.snapshot.layoutRevision).toBe(beforeActivation.layoutRevision + 1)
  })

  it('rejects oversized or control-character bindings before allocating a panel', async () => {
    const store = fixture()
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const oversized = await store.openPanel({ requestId: 'oversized', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'x'.repeat(257) })
    const control = await store.openPanel({ requestId: 'control', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'safe\u0000key' })

    expect(oversized).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    expect(control).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    expect(store.getSnapshot().panels).toHaveLength(0)
  })

  it('requires the transfer coordinator to move a detached panel back to a dock', async () => {
    const store = fixture()
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const panel = await store.openPanel({ requestId: 'panel', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector' })
    const rejected = await store.switchContainer({ requestId: 'detached', expectedRevision: 2, hostEpoch: 1,
      panelInstanceKey: panel.panelInstanceKey, mode: 'detached' })
    expect(rejected).toMatchObject({ status: 'rejected', errorCode: 'unsupported' })
  })

  it('does not change a detached host into a dock mode without a transfer commit', async () => {
    const store = fixture()
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const panel = await store.openPanel({ requestId: 'panel', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector' })
    const transfer = createWorkspaceTransferCoordinator(store)
    const began = await transfer.begin({ requestId: 'detach', requestScope: 'main', expectedRevision: 2,
      hostEpoch: 1, windowInstanceId: 'main', panelInstanceKey: panel.panelInstanceKey, targetMode: 'detached' })
    if (began.status !== 'preparing') throw new Error('expected preparing transfer')
    await transfer.sourcePrepared({ operationId: began.operation.operationId, host: began.operation.source, result: { status: 'ready' } })
    await transfer.targetReady({ operationId: began.operation.operationId, host: began.operation.target })
    await transfer.sourceReleased({ operationId: began.operation.operationId, host: began.operation.source })
    await transfer.commit(began.operation.operationId)
    const detached = store.getSnapshot().panels[0]
    const rejected = await store.switchContainer({ requestId: 'dock', expectedRevision: detached ? store.getSnapshot().layoutRevision : 0,
      hostEpoch: detached?.hostEpoch ?? 0, windowInstanceId: detached?.windowInstanceId ?? '',
      panelInstanceKey: panel.panelInstanceKey, mode: 'docked-right' })
    expect(rejected).toMatchObject({ status: 'rejected', errorCode: 'unsupported' })
  })

  it('selects the next same-mode panel when moving the active panel', async () => {
    const store = fixture({ allowMultipleInstances: true })
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const first = await store.openPanel({ requestId: 'first', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'first' })
    const second = await store.openPanel({ requestId: 'second', expectedRevision: 2, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'second', newInstance: true })
    await store.activatePanel({ requestId: 'activate-first', expectedRevision: 3, hostEpoch: 1,
      panelInstanceKey: first.panelInstanceKey })

    const moved = await store.switchContainer({ requestId: 'move-active', expectedRevision: 4, hostEpoch: 1,
      panelInstanceKey: first.panelInstanceKey, mode: 'docked-right' })

    expect(moved.snapshot.pageLayouts[0]?.activePanels).toEqual({ embedded: second.panelInstanceKey, 'docked-right': first.panelInstanceKey })
  })

  it('keeps the old active panel when moving a non-active panel', async () => {
    const store = fixture({ allowMultipleInstances: true })
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const first = await store.openPanel({ requestId: 'first', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'first' })
    const second = await store.openPanel({ requestId: 'second', expectedRevision: 2, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'second', newInstance: true })

    const moved = await store.switchContainer({ requestId: 'move-inactive', expectedRevision: 3, hostEpoch: 1,
      panelInstanceKey: first.panelInstanceKey, mode: 'docked-right' })

    expect(moved.snapshot.pageLayouts[0]?.activePanels).toEqual({ embedded: second.panelInstanceKey, 'docked-right': first.panelInstanceKey })
  })

  it('selects the next same-mode panel when transfer commit detaches the active panel', async () => {
    const store = fixture({ allowMultipleInstances: true })
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const first = await store.openPanel({ requestId: 'first', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'first' })
    const second = await store.openPanel({ requestId: 'second', expectedRevision: 2, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'second', newInstance: true })
    await store.activatePanel({ requestId: 'activate-first', expectedRevision: 3, hostEpoch: 1,
      panelInstanceKey: first.panelInstanceKey })
    const transfer = createWorkspaceTransferCoordinator(store)
    const began = await transfer.begin({ requestId: 'detach', requestScope: 'main', expectedRevision: 4,
      hostEpoch: 1, windowInstanceId: 'main', panelInstanceKey: first.panelInstanceKey, targetMode: 'detached' })
    if (began.status !== 'preparing') throw new Error('expected preparing transfer')
    await transfer.sourcePrepared({ operationId: began.operation.operationId, host: began.operation.source, result: { status: 'ready' } })
    await transfer.targetReady({ operationId: began.operation.operationId, host: began.operation.target })
    await transfer.sourceReleased({ operationId: began.operation.operationId, host: began.operation.source })
    await transfer.commit(began.operation.operationId)

    expect(store.getSnapshot().pageLayouts[0]?.activePanels).toEqual({ embedded: second.panelInstanceKey })
  })

  it('rejects a detached switch once the named detached-host budget is full', async () => {
    const store = fixture({ allowMultipleInstances: true })
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const first = await store.openPanel({ requestId: 'first', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'one' })
    const transfer = createWorkspaceTransferCoordinator(store)
    const detach = (await transfer.begin({ requestId: 'detach', requestScope: 'main', expectedRevision: 2, hostEpoch: 1, windowInstanceId: 'main', panelInstanceKey: first.panelInstanceKey, targetMode: 'detached' }))
    if (detach.status !== 'preparing') throw new Error('expected preparing transfer')
    await transfer.sourcePrepared({ operationId: detach.operation.operationId, host: detach.operation.source, result: { status: 'ready' } })
    await transfer.targetReady({ operationId: detach.operation.operationId, host: detach.operation.target })
    await transfer.sourceReleased({ operationId: detach.operation.operationId, host: detach.operation.source })
    let revision = store.getSnapshot().layoutRevision
    for (let index = 0; index < 7; index += 1) {
      const opened = await store.openPanel({ requestId: `panel-${index}`, expectedRevision: revision, hostEpoch: 1,
        workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: `key-${index}`, newInstance: true })
      const next = await transfer.begin({ requestId: `detach-${index}`, requestScope: 'main', expectedRevision: opened.snapshot.layoutRevision, hostEpoch: 1, windowInstanceId: 'main', panelInstanceKey: opened.panelInstanceKey, targetMode: 'detached' })
      if (next.status !== 'preparing') throw new Error('expected preparing transfer')
      await transfer.sourcePrepared({ operationId: next.operation.operationId, host: next.operation.source, result: { status: 'ready' } })
      await transfer.targetReady({ operationId: next.operation.operationId, host: next.operation.target })
      await transfer.sourceReleased({ operationId: next.operation.operationId, host: next.operation.source })
      revision = store.getSnapshot().layoutRevision
    }
    const extra = await store.openPanel({ requestId: 'extra', expectedRevision: revision, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'extra', newInstance: true })
    const rejected = await transfer.begin({ requestId: 'detach-extra', requestScope: 'main', expectedRevision: extra.snapshot.layoutRevision,
      hostEpoch: 1, windowInstanceId: 'main', panelInstanceKey: extra.panelInstanceKey, targetMode: 'detached' })
    expect(rejected).toMatchObject({ status: 'rejected', errorCode: 'limit-reached' })
  })

  it('returns the original outcome for duplicate request IDs and preserves opened panels on app exit', async () => {
    const store = fixture()
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const first = await store.openPanel({ requestId: 'open', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'session' })
    const replay = await store.openPanel({ requestId: 'open', requestScope: 'other-window', expectedRevision: 999, hostEpoch: 0, workspaceInstanceKey: 'wrong', panelId: 'wrong', bindingKey: 'wrong' })
    const exited = await store.prepareForAppExit()

    expect(replay).toMatchObject({ status: 'rejected', errorCode: 'stale-revision' })
    expect(exited.panels).toEqual([expect.objectContaining({ panelInstanceKey: first.panelInstanceKey, open: true })])
    expect(Object.isFrozen(exited)).toBe(true)
  })
})

describe('panel layout persistence handoff', () => {
  it('records a dock size, resets it and enforces revision and ownership', async () => {
    const store = fixture()
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const panel = await store.openPanel({ requestId: 'open', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'session' })

    const resized = await store.resizePanel({ requestId: 'resize', expectedRevision: 2, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey, dockSize: { width: 480.4, height: 360.6 } })
    expect(resized.status).toBe('applied')
    expect(resized.snapshot.panels[0]?.dockSize).toEqual({ width: 480, height: 361 })

    const stale = await store.resizePanel({ requestId: 'stale', expectedRevision: 2, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey, dockSize: { width: 300, height: 300 } })
    expect(stale).toMatchObject({ status: 'rejected', errorCode: 'stale-revision' })
    const foreign = await store.resizePanel({ requestId: 'foreign', expectedRevision: 3, hostEpoch: 9, panelInstanceKey: panel.panelInstanceKey, dockSize: { width: 300, height: 300 } })
    expect(foreign).toMatchObject({ status: 'rejected', errorCode: 'not-owner' })
    const invalid = await store.resizePanel({ requestId: 'invalid', expectedRevision: 3, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey, dockSize: { width: Number.NaN, height: 300 } })
    expect(invalid).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })

    const reset = await store.resetPanelSize({ requestId: 'reset', expectedRevision: 3, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey })
    expect(reset.status).toBe('applied')
    expect(reset.snapshot.panels[0]?.dockSize).toBeUndefined()
  })

  it('reopens a closed panel and drops it from the session-only recently closed list', async () => {
    const store = fixture()
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const panel = await store.openPanel({ requestId: 'open', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'session' })
    const closed = await store.closePanel({ requestId: 'close', expectedRevision: 2, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey })

    expect(closed.snapshot.panels[0]).toMatchObject({ open: false })
    expect(closed.snapshot.pageLayouts[0]?.activePanels).toEqual({})
    expect(store.recentlyClosed()).toEqual([{ panelInstanceKey: panel.panelInstanceKey, panelId: 'sample.inspector', workspaceInstanceKey: page.workspaceInstanceKey, mode: 'embedded' }])

    const reopened = await store.reopenPanel({ requestId: 'reopen', expectedRevision: 3, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey })
    expect(reopened.status).toBe('applied')
    expect(reopened.snapshot.panels[0]).toMatchObject({ open: true, mode: 'embedded' })
    expect(reopened.snapshot.pageLayouts[0]?.activePanels).toEqual({ embedded: panel.panelInstanceKey })
    expect(store.recentlyClosed()).toEqual([])
  })

  it('bounds the session recently closed list to the documented limit and starts empty on a fresh store', async () => {
    const store = fixture({ allowMultipleInstances: true })
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    let revision = 1
    const keys: string[] = []
    for (let index = 0; index < 12; index += 1) {
      const opened = await store.openPanel({ requestId: `open-${index}`, expectedRevision: revision, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: `key-${index}`, newInstance: true })
      revision = opened.snapshot.layoutRevision
      keys.push(opened.panelInstanceKey)
      const closed = await store.closePanel({ requestId: `close-${index}`, expectedRevision: revision, hostEpoch: 1, panelInstanceKey: opened.panelInstanceKey })
      revision = closed.snapshot.layoutRevision
    }

    const recent = store.recentlyClosed()
    expect(recent).toHaveLength(10)
    expect(recent[0]?.panelInstanceKey).toBe(keys[11])
    expect(recent[9]?.panelInstanceKey).toBe(keys[2])
    expect(fixture().recentlyClosed()).toEqual([]) // 仅会话内存：新实例（重启）为空
  })

  it('exports durable binding keys only and never session keys or business fields', async () => {
    const durable = fixture({ bindingPersistence: 'durable' })
    const page = await durable.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const kept = await durable.openPanel({ requestId: 'durable', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'durable-key-a' })
    await durable.resizePanel({ requestId: 'resize', expectedRevision: 2, hostEpoch: 1, panelInstanceKey: kept.panelInstanceKey, dockSize: { width: 500, height: 400 } })
    const exported = durable.exportLayoutDocument({ savedAt: '2026-10-05T00:00:00.000Z' })

    expect(exported.status).toBe('ok')
    if (exported.status !== 'ok') return
    expect(exported.document.panels[0]).toMatchObject({ binding: { key: 'durable-key-a' }, dockSize: { width: 500, height: 400 }, open: true })
    expect(JSON.stringify(exported.document)).not.toContain('windowInstanceId')

    const session = fixture({ bindingPersistence: 'session' })
    const sessionPage = await session.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    await session.openPanel({ requestId: 'session', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: sessionPage.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'session-secret-key' })
    const sessionExport = session.exportLayoutDocument({ savedAt: '2026-10-05T00:00:00.000Z' })

    expect(sessionExport.status).toBe('ok')
    if (sessionExport.status !== 'ok') return
    expect(sessionExport.document.panels[0]?.binding).toBeUndefined()
    expect(JSON.stringify(sessionExport.document)).not.toContain('session-secret-key')
  })

  it('keeps open panels open across app exit without writing open=false', async () => {
    const store = fixture({ bindingPersistence: 'durable' })
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const opened = await store.openPanel({ requestId: 'open', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'durable-key-a' })
    const closedPanel = await store.openPanel({ requestId: 'open-2', expectedRevision: 2, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'durable-key-b' })
    await store.closePanel({ requestId: 'close', expectedRevision: 3, hostEpoch: 1, panelInstanceKey: closedPanel.panelInstanceKey })

    const exited = await store.prepareForAppExit()
    const exported = store.exportLayoutDocument({ savedAt: '2026-10-05T00:00:00.000Z' })

    expect(exported.status).toBe('ok')
    if (exported.status !== 'ok') return
    expect(exited.panels.find((panel) => panel.panelInstanceKey === opened.panelInstanceKey)).toMatchObject({ open: true })
    expect(exported.document.panels.find((panel) => panel.panelInstanceKey === opened.panelInstanceKey)).toMatchObject({ open: true })
    // 显式关闭的面板必须保持关闭，绝不在退出时被写成 open=true
    expect(exported.document.panels.find((panel) => panel.panelInstanceKey === closedPanel.panelInstanceKey)).toMatchObject({ open: false })
  })

  it('restores order, active panels, mode, lastValidDock, dockSize and open from a document', async () => {
    const source = fixture({ bindingPersistence: 'durable' })
    const page = await source.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const first = await source.openPanel({ requestId: 'open-a', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'durable-key-a' })
    const second = await source.openPanel({ requestId: 'open-b', expectedRevision: 2, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'durable-key-b' })
    await source.resizePanel({ requestId: 'resize', expectedRevision: 3, hostEpoch: 1, panelInstanceKey: first.panelInstanceKey, dockSize: { width: 420, height: 320 } })
    await source.switchContainer({ requestId: 'dock', expectedRevision: 4, hostEpoch: 1, panelInstanceKey: first.panelInstanceKey, mode: 'docked-right' })
    await source.closePanel({ requestId: 'close', expectedRevision: 5, hostEpoch: 1, panelInstanceKey: second.panelInstanceKey })
    const before = source.getSnapshot()
    const exported = source.exportLayoutDocument({ savedAt: '2026-10-05T00:00:00.000Z' })
    expect(exported.status).toBe('ok')
    if (exported.status !== 'ok') return

    const restoredStore = fixture({ bindingPersistence: 'durable' })
    const applied = await restoredStore._restoreLayout({ requestId: 'restore', expectedRevision: 0, document: exported.document })
    expect(applied.status).toBe('applied')

    const after = restoredStore.getSnapshot()
    expect(after.pageLayouts[0]?.panelOrder).toEqual(before.pageLayouts[0]?.panelOrder)
    expect(after.pageLayouts[0]?.activePanels).toEqual(before.pageLayouts[0]?.activePanels)
    expect(after.panels.find((panel) => panel.panelInstanceKey === first.panelInstanceKey)).toMatchObject({ open: true, mode: 'docked-right', lastValidDock: 'docked-right', dockSize: { width: 420, height: 320 } })
    expect(after.panels.find((panel) => panel.panelInstanceKey === second.panelInstanceKey)).toMatchObject({ open: false })
  })

  it('prunes unregistered pages and panels on restore while keeping the rest of the layout', async () => {
    const source = fixture()
    const page = await source.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    await source.openPanel({ requestId: 'open', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'session' })
    const exported = source.exportLayoutDocument({ savedAt: '2026-10-05T00:00:00.000Z' })
    expect(exported.status).toBe('ok')
    if (exported.status !== 'ok') return

    const withGone = {
      ...exported.document,
      workspaces: [...exported.document.workspaces, { workspaceInstanceKey: 'workspace_gone', pageId: 'gone.page', panelOrder: [], activePanels: {} }],
      panels: [...exported.document.panels, { panelInstanceKey: 'panel_gone', workspaceInstanceKey: 'workspace_gone', panelId: 'gone.panel', open: true, mode: 'embedded' as const, lastValidDock: 'embedded' as const }]
    }
    const restoredStore = fixture()
    const applied = await restoredStore._restoreLayout({ requestId: 'restore', expectedRevision: 0, document: withGone })

    expect(applied.status).toBe('applied')
    const after = restoredStore.getSnapshot()
    expect(after.pageLayouts).toHaveLength(1)
    expect(after.pageLayouts[0]?.workspaceInstanceKey).toBe(page.workspaceInstanceKey)
    expect(after.pageLayouts[0]?.panelOrder).toHaveLength(1)
    expect(after.panels).toHaveLength(1)
  })

  it('refuses a late restore whose revision was already advanced by a user action (CAS)', async () => {
    const source = fixture()
    const page = await source.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    await source.openPanel({ requestId: 'open', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'session' })
    const exported = source.exportLayoutDocument({ savedAt: '2026-10-05T00:00:00.000Z' })
    expect(exported.status).toBe('ok')
    if (exported.status !== 'ok') return

    const late = fixture()
    // 用户在 restore 结果到达前已经操作（revision 0 → 1）
    await late.openWorkspace({ requestId: 'user', expectedRevision: 0, pageId: 'sample.page-a' })
    const rejected = await late._restoreLayout({ requestId: 'restore', expectedRevision: 0, document: exported.document })

    expect(rejected).toMatchObject({ status: 'rejected', errorCode: 'stale-revision' })
    expect(rejected.snapshot.pageLayouts).toHaveLength(1) // 用户自己的布局未被覆盖
    expect(rejected.snapshot.panels).toEqual([])
  })
})

describe('restore fallback and revision semantics', () => {
  function documentWith(overrides: { mode: PanelContainerMode; lastValidDock: 'embedded' | 'docked-right' | 'docked-bottom'; panelId?: string }): PanelLayoutDocumentV1 {
    return {
      schemaVersion: 1, savedAt: '2026-10-05T00:00:00.000Z', layoutRevision: 3,
      workspaces: [{ workspaceInstanceKey: 'workspace_stored', pageId: 'sample.page-a', panelOrder: ['panel_stored'], activePanels: {} }],
      panels: [{
        panelInstanceKey: 'panel_stored', workspaceInstanceKey: 'workspace_stored', panelId: overrides.panelId ?? 'sample.inspector',
        open: true, mode: overrides.mode, lastValidDock: overrides.lastValidDock
      }]
    }
  }

  it('restores a panel whose stored mode is unsupported by falling back inside the supported set', async () => {
    const store = fixture({ supportedModes: ['embedded', 'docked-bottom'] })
    const applied = await store._restoreLayout({ requestId: 'restore', expectedRevision: 0, document: documentWith({ mode: 'docked-right', lastValidDock: 'docked-right' }) })

    expect(applied).toMatchObject({ status: 'applied', prunedPanels: 0 })
    const after = store.getSnapshot()
    expect(after.panels).toHaveLength(1)
    expect(['embedded', 'docked-bottom']).toContain(after.panels[0]?.mode)
    expect(after.panels[0]?.mode).toBe('docked-bottom') // §6 安全链跳过不支持的 right
    expect(after.panels[0]?.lastValidDock).toBe('docked-bottom')
    expect(after.pageLayouts[0]?.panelOrder).toEqual(['panel_stored'])
  })

  it('still prunes a panel whose registration disappeared entirely', async () => {
    const store = fixture()
    const applied = await store._restoreLayout({ requestId: 'restore', expectedRevision: 0, document: documentWith({ mode: 'embedded', lastValidDock: 'embedded', panelId: 'gone.panel' }) })

    expect(applied).toMatchObject({ status: 'applied', prunedPanels: 1 })
    expect(store.getSnapshot().panels).toEqual([])
    expect(store.getSnapshot().pageLayouts[0]?.panelOrder).toEqual([])
  })

  it('bumps the revision when reopening switches the active workspace', async () => {
    const store = fixture()
    const pageA = await store.openWorkspace({ requestId: 'a', expectedRevision: 0, pageId: 'sample.page-a' })
    const panelA = await store.openPanel({ requestId: 'pa', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: pageA.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'a' })
    const pageB = await store.openWorkspace({ requestId: 'b', expectedRevision: 2, pageId: 'sample.page-b' })
    await store.openPanel({ requestId: 'pb', expectedRevision: 3, hostEpoch: 1, workspaceInstanceKey: pageB.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'b' })

    const before = store.getSnapshot()
    expect(before.activeWorkspaceInstanceKey).toBe(pageB.workspaceInstanceKey)
    const reopened = await store.reopenPanel({ requestId: 'reopen-a', expectedRevision: before.layoutRevision, hostEpoch: 1, panelInstanceKey: panelA.panelInstanceKey })

    expect(reopened.status).toBe('applied')
    expect(reopened.snapshot.activeWorkspaceInstanceKey).toBe(pageA.workspaceInstanceKey)
    expect(reopened.snapshot.layoutRevision).toBe(before.layoutRevision + 1) // 与 activatePanel 的 workspaceChanged 语义一致
  })

  it('does not bump the revision for an identical dock size', async () => {
    const store = fixture()
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const panel = await store.openPanel({ requestId: 'open', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'session' })
    const first = await store.resizePanel({ requestId: 'r1', expectedRevision: 2, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey, dockSize: { width: 480, height: 360 } })
    const again = await store.resizePanel({ requestId: 'r2', expectedRevision: first.snapshot.layoutRevision, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey, dockSize: { width: 480, height: 360 } })

    expect(again.status).toBe('applied')
    expect(again.snapshot.layoutRevision).toBe(first.snapshot.layoutRevision) // 尺寸无变化不得让其它窗口误判 stale
  })
})

describe('transfer target identity (P1-06c)', () => {
  /** 打开一个 workspace + panel（主窗身份 main/1），返回可直接开事务的上下文。 */
  async function opened() {
    const store = fixture()
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const panel = await store.openPanel({
      requestId: 'panel', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector'
    })
    return { store, page, panel }
  }
  const begin = (
    context: Awaited<ReturnType<typeof opened>>,
    requestId: string,
    extra: { targetMode?: PanelContainerMode; targetHost?: { windowInstanceId: string; hostEpoch: number } } = {}
  ) => context.store._beginTransfer({
    requestId, requestScope: 'main', expectedRevision: 2, hostEpoch: 1, windowInstanceId: 'main',
    panelInstanceKey: context.panel.panelInstanceKey, targetMode: extra.targetMode ?? 'detached',
    ...(extra.targetHost === undefined ? {} : { targetHost: extra.targetHost })
  })

  it('采用调用方提供的目标身份，绝不再自造一个 windowInstanceId', async () => {
    const context = await opened()
    const result = await begin(context, 'detach', { targetHost: { windowInstanceId: 'window-reserved', hostEpoch: 2 } })

    expect(result.status).toBe('preparing')
    if (result.status !== 'preparing') return
    // 目标身份逐字来自调用方（Main 侧预留窗口的登记身份），而不是 store 自己 createId 的结果
    expect(result.operation.target).toEqual({ windowInstanceId: 'window-reserved', hostEpoch: 2 })
    expect(result.operation.target.windowInstanceId).not.toContain('00000000-0000-4000-8000')
    expect(result.operation.source).toEqual({ windowInstanceId: 'main', hostEpoch: 1 })
    expect(result.snapshot.panels[0]?.transfer).toMatchObject({ operationId: result.operation.operationId, phase: 'awaiting-source-prepared' })
  })

  it('调用方给的目标身份形状非法时拒绝请求，绝不静默改回自造身份', async () => {
    const context = await opened()
    const invalid: Array<{ windowInstanceId: unknown; hostEpoch: unknown }> = [
      { windowInstanceId: '', hostEpoch: 2 },
      { windowInstanceId: '   ', hostEpoch: 2 },
      { windowInstanceId: 'x'.repeat(201), hostEpoch: 2 },
      { windowInstanceId: 7, hostEpoch: 2 },
      { windowInstanceId: 'window-a', hostEpoch: 0 },
      { windowInstanceId: 'window-a', hostEpoch: 1.5 },
      { windowInstanceId: 'window-a', hostEpoch: Number.MAX_SAFE_INTEGER + 1 }
    ]
    for (const [index, targetHost] of invalid.entries()) {
      const rejected = await begin(context, `bad-${index}`, { targetHost: targetHost as { windowInstanceId: string; hostEpoch: number } })
      expect(rejected).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    }
    expect(context.store.getSnapshot().panels[0]?.transfer).toBeUndefined()
    expect(context.store.getSnapshot().layoutRevision).toBe(2)
  })

  it('缺省目标身份时保留 P1-05 语义：detached 自造身份、回停靠回主窗哨兵', async () => {
    const detachedContext = await opened()
    const detached = await begin(detachedContext, 'detach')
    expect(detached.status).toBe('preparing')
    if (detached.status !== 'preparing') return
    expect(detached.operation.target).toMatchObject({ hostEpoch: 2 })
    expect(detached.operation.target.windowInstanceId).toContain('00000000-0000-4000-8000')

    const redockContext = await opened()
    const redock = await begin(redockContext, 'redock', { targetMode: 'docked-right' })
    expect(redock.status).toBe('preparing')
    if (redock.status !== 'preparing') return
    expect(redock.operation.target).toEqual({ windowInstanceId: 'main', hostEpoch: 1 })
  })
})

describe('requestId 幂等缓存 fail closed (P1-06g / D2)', () => {
  /** 打开一个 workspace + panel，返回可直接发命令的上下文（主窗身份 main/1）。 */
  async function opened() {
    const store = fixture()
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const panel = await store.openPanel({
      requestId: 'panel', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector'
    })
    return { store, panelInstanceKey: panel.panelInstanceKey }
  }

  it('方法 + 参数逐字相同的重复请求仍幂等回放（保留既有语义）', async () => {
    const { store, panelInstanceKey } = await opened()
    const request = { requestId: 'replay', requestScope: 'main', expectedRevision: 2, hostEpoch: 1, panelInstanceKey }

    const first = await store.activatePanel(request)
    const revisionAfterFirst = first.snapshot.layoutRevision
    const second = await store.activatePanel({ ...request })

    expect(first.status).toBe('applied')
    expect(second).toEqual(first) // 同一份权威结果，不重放第二次
    expect(store.getSnapshot().layoutRevision).toBe(revisionAfterFirst)
  })

  it('同 requestScope:requestId 携带不同参数 ⇒ invalid-request，绝不回放旧响应', async () => {
    const { store, panelInstanceKey } = await opened()
    const first = await store.switchContainer({
      requestId: 'duplicate', requestScope: 'main', expectedRevision: 2, hostEpoch: 1, panelInstanceKey, mode: 'docked-right'
    })
    const conflicting = await store.switchContainer({
      requestId: 'duplicate', requestScope: 'main', expectedRevision: 3, hostEpoch: 1, panelInstanceKey, mode: 'docked-bottom'
    })

    expect(first.status).toBe('applied')
    expect(conflicting).toMatchObject({ status: 'rejected', errorCode: 'invalid-request', panelInstanceKey })
    // 旧响应绝不回放：本次命令既没被静默丢弃，也没把布局改成第一次的模式
    expect(store.getSnapshot().panels.find((panel) => panel.panelInstanceKey === panelInstanceKey)?.mode).toBe('docked-right')
    expect(store.getSnapshot().layoutRevision).toBe(first.snapshot.layoutRevision)
  })

  it('同 requestScope:requestId 携带不同方法 ⇒ invalid-request，且绝不执行第二次调用', async () => {
    const { store, panelInstanceKey } = await opened()
    const first = await store.activatePanel({
      requestId: 'cross-method', requestScope: 'main', expectedRevision: 2, hostEpoch: 1, panelInstanceKey
    })
    const conflicting = await store.closePanel({
      requestId: 'cross-method', requestScope: 'main', expectedRevision: 3, hostEpoch: 1, panelInstanceKey
    })

    expect(first.status).toBe('applied')
    expect(conflicting).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    // 面板绝不能被「回放成 applied」以外的路径关掉
    expect(store.getSnapshot().panels.find((panel) => panel.panelInstanceKey === panelInstanceKey)?.open).toBe(true)
  })

  it('requestScope 参与缓存 key：不同作用域的同名 requestId 互不影响', async () => {
    const { store, panelInstanceKey } = await opened()
    const mainScope = await store.activatePanel({
      requestId: 'same-id', requestScope: 'main', expectedRevision: 2, hostEpoch: 1, panelInstanceKey
    })
    const panelScope = await store.closePanel({
      requestId: 'same-id', requestScope: 'window-panel-1',
      expectedRevision: store.getSnapshot().layoutRevision, hostEpoch: 1, panelInstanceKey
    })

    expect(mainScope.status).toBe('applied')
    expect(panelScope.status).toBe('applied')
    expect(store.getSnapshot().panels.find((panel) => panel.panelInstanceKey === panelInstanceKey)?.open).toBe(false)
  })

  it('内部相位 ACK 的幂等入口同样 fail closed：同 requestId 不同请求体不推进相位', async () => {
    const { store, panelInstanceKey } = await opened()
    const first = await store._beginTransfer({
      requestId: 'transfer', requestScope: 'main', expectedRevision: 2, hostEpoch: 1, windowInstanceId: 'main',
      panelInstanceKey, targetMode: 'detached', targetHost: { windowInstanceId: 'window-reserved', hostEpoch: 2 }
    })
    const conflicting = await store._beginTransfer({
      requestId: 'transfer', requestScope: 'main', expectedRevision: 2, hostEpoch: 1, windowInstanceId: 'main',
      panelInstanceKey, targetMode: 'detached', targetHost: { windowInstanceId: 'window-other', hostEpoch: 9 }
    })

    expect(first.status).toBe('preparing')
    expect(first.status === 'preparing' && first.operation.target).toEqual({ windowInstanceId: 'window-reserved', hostEpoch: 2 })
    expect(conflicting).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    // 飞事务目标身份仍是最先那个，绝不被第二次（不同目标）覆盖
    const transfer = store.getSnapshot().panels.find((panel) => panel.panelInstanceKey === panelInstanceKey)?.transfer
    expect(transfer?.operationId).toBe(first.status === 'preparing' ? first.operation.operationId : '')
  })
})

describe('请求指纹护栏 (P1-06h)：环引用 / 超深结构 fail closed', () => {
  /** 打开一个 workspace + panel，返回可直接发命令的上下文（主窗身份 main/1）。 */
  async function opened() {
    const store = fixture()
    const page = await store.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const panel = await store.openPanel({
      requestId: 'panel', expectedRevision: 1, hostEpoch: 1,
      workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector'
    })
    return { store, panelInstanceKey: panel.panelInstanceKey }
  }

  it('环引用参数 ⇒ invalid-request（不是 RangeError），且绝不改布局、不写缓存', async () => {
    const { store, panelInstanceKey } = await opened()
    const cyclic: Record<string, unknown> = { requestId: 'cyclic', expectedRevision: 2, hostEpoch: 1, panelInstanceKey }
    cyclic.self = cyclic
    const result = await store.activatePanel(cyclic as never)

    expect(result).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    // 命令没有执行：revision 与面板可见状态原样
    expect(store.getSnapshot().layoutRevision).toBe(2)
    expect(store.getSnapshot().panels.find((panel) => panel.panelInstanceKey === panelInstanceKey)?.open).toBe(true)
  })

  it('超深嵌套参数 ⇒ invalid-request（有界深度护栏），绝不 RangeError', async () => {
    const { store, panelInstanceKey } = await opened()
    let deep: unknown = 1
    for (let level = 0; level < 200; level += 1) deep = [deep]
    const result = await store.activatePanel({
      requestId: 'deep', expectedRevision: 2, hostEpoch: 1, panelInstanceKey, extra: deep
    } as never)

    expect(result).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })
    expect(store.getSnapshot().layoutRevision).toBe(2)
  })

  it('环引用失败绝不污染幂等缓存：同一 requestId 随后用合法参数仍可执行', async () => {
    const { store, panelInstanceKey } = await opened()
    const cyclic: Record<string, unknown> = {
      requestId: 'retry', expectedRevision: 2, hostEpoch: 1, panelInstanceKey, mode: 'docked-right'
    }
    cyclic.self = cyclic
    expect(await store.switchContainer(cyclic as never)).toMatchObject({ status: 'rejected', errorCode: 'invalid-request' })

    const retried = await store.switchContainer({
      requestId: 'retry', expectedRevision: 2, hostEpoch: 1, panelInstanceKey, mode: 'docked-right'
    })
    expect(retried).toMatchObject({ status: 'applied' })
    expect(store.getSnapshot().layoutRevision).toBe(3)
    expect(store.getSnapshot().panels.find((panel) => panel.panelInstanceKey === panelInstanceKey)?.mode).toBe('docked-right')
  })
})
