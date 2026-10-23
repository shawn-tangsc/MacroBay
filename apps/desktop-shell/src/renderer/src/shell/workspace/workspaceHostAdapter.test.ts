import { describe, expect, it } from 'vitest'

import type { WorkspacePreparation } from '@platform/workspace/contracts'
import { createWorkspaceContentAdapter, prepareWorkspaceHandoff, type WorkspaceContentReleaseResult } from './workspaceHostAdapter'

/**
 * Owner: apps/desktop-shell renderer / workspace 内容适配器。
 * 权威：P1-03 纠偏裁决 §4/§9（prepare 四态、release 真正一次性异步释放）。
 * 本文件独立验证 release 语义；宿主本包不接 release（见 WorkspacePanelHost.test.tsx 的 disposed 断言）。
 */

describe('prepareWorkspaceHandoff', () => {
  it('distinguishes ready, unsaved-content, sensitive-draft and unsupported-handoff', () => {
    expect(prepareWorkspaceHandoff({ status: 'ready' })).toEqual({ status: 'ready' })
    expect(prepareWorkspaceHandoff({ status: 'ready', data: { draft: 'kept' } }))
      .toEqual({ status: 'ready', handoff: { version: 1, data: { draft: 'kept' } } })
    expect(prepareWorkspaceHandoff({ status: 'dirty' })).toEqual({ status: 'handoff-required', reason: 'unsaved-content' })
    expect(prepareWorkspaceHandoff({ status: 'dirty', sensitive: true })).toEqual({ status: 'handoff-required', reason: 'sensitive-draft' })
    expect(prepareWorkspaceHandoff({ status: 'unsupported' })).toEqual({ status: 'handoff-required', reason: 'unsupported-handoff' })
  })
})

describe('createWorkspaceContentAdapter', () => {
  it('forwards prepare every time instead of caching a stale conclusion', async () => {
    let preparation: WorkspacePreparation = { status: 'ready' }
    const adapter = createWorkspaceContentAdapter({ prepare: () => preparation, release: () => undefined })
    expect(await adapter.prepare()).toEqual({ status: 'ready' })
    preparation = { status: 'handoff-required', reason: 'sensitive-draft' }
    expect(await adapter.prepare()).toEqual({ status: 'handoff-required', reason: 'sensitive-draft' })
    preparation = { status: 'ready', handoff: { version: 1, data: 'x' } }
    expect(await adapter.prepare()).toEqual({ status: 'ready', handoff: { version: 1, data: 'x' } })
  })

  it('acknowledges release only after the asynchronous content release completes, then fails closed', async () => {
    let finish: () => void = () => undefined
    const gate = new Promise<void>((settle) => { finish = settle })
    const calls: string[] = []
    const observed: { settled: WorkspaceContentReleaseResult | null } = { settled: null }
    const adapter = createWorkspaceContentAdapter({
      prepare: () => ({ status: 'ready' }),
      release: async () => { calls.push('release'); await gate }
    })
    const pending = adapter.release().then((value) => { observed.settled = value; return value })
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    expect(observed.settled).toBeNull()
    expect(await adapter.release()).toEqual({ status: 'rejected', reason: 'release-in-progress' })
    expect(calls).toHaveLength(1)
    finish()
    expect(await pending).toEqual({ status: 'released', acknowledged: true })
    expect(observed.settled).toEqual({ status: 'released', acknowledged: true })
    expect(await adapter.release()).toEqual({ status: 'rejected', reason: 'already-released' })
    expect(calls).toHaveLength(1)
  })

  it('fails closed when the underlying release throws and never leaks the error body', async () => {
    let calls = 0
    const adapter = createWorkspaceContentAdapter({
      prepare: () => ({ status: 'ready' }),
      release: async () => { calls += 1; throw new Error('private failure payload') }
    })
    const result = await adapter.release()
    expect(result).toEqual({ status: 'rejected', reason: 'release-failed' })
    expect(JSON.stringify(result)).not.toContain('private failure payload')
    expect(await adapter.release()).toEqual({ status: 'rejected', reason: 'release-failed' })
    expect(calls).toBe(1)
  })
})
