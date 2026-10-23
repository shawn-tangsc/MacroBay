import { describe, expect, it, vi } from 'vitest'

import {
  createWorkspaceDraftGate,
  prepareDraftHandoff,
  reviewWorkspaceDraft,
  runWorkspaceDraftBatch,
  type WorkspaceDraftOwnerPort,
  type WorkspaceDraftProbe
} from './workspaceDraftGate'

/**
 * Owner: apps/desktop-shell renderer / workspace 草稿保护（P2-02）。
 * 权威：技术设计 §6「dirty draft 不能安全交接时，保存/明确丢弃/取消；敏感草稿绝不进入 handoff」、
 * A-P04「草稿不静默丢失；取消保留原窗」、A-T08「敏感草稿保存/丢弃/取消，无泄漏」。
 *
 * 本文件只验证**纯 gate 语义**；「gate 读的是真实已有表单草稿」由
 * `settings/SettingsWorkspaceAdapter.test.tsx` 用真实 owner 集成证明。
 */

/** 真实草稿状态的 owner：probe 读的是活状态，不是外部布尔开关。 */
function createLiveOwner(input: { sensitivity?: 'safe' | 'sensitive'; failSave?: boolean } = {}) {
  const owner = {
    draft: 'draft-body',
    saved: [] as string[],
    discarded: 0,
    probe: vi.fn((): WorkspaceDraftProbe => (owner.draft.length === 0
      ? { status: 'clean' }
      : { status: 'dirty', sensitivity: input.sensitivity ?? 'safe' })),
    save: vi.fn(async () => {
      if (input.failSave) throw new Error('provider-secret-vault-write-failed')
      owner.saved.push(owner.draft)
      owner.draft = ''
    }),
    discard: vi.fn(() => { owner.discarded += 1; owner.draft = '' })
  } satisfies WorkspaceDraftOwnerPort & { draft: string; saved: string[]; discarded: number }
  return owner
}

describe('prepareDraftHandoff：未保存的安全草稿必须交接，敏感草稿绝不进入平台 handoff', () => {
  it('maps clean, safe and sensitive probes onto the contract vocabulary', () => {
    expect(prepareDraftHandoff({ status: 'clean' })).toEqual({ status: 'ready' })
    expect(prepareDraftHandoff({ status: 'dirty', sensitivity: 'safe' }))
      .toEqual({ status: 'handoff-required', reason: 'unsaved-content' })
    expect(prepareDraftHandoff({ status: 'dirty', sensitivity: 'sensitive' }))
      .toEqual({ status: 'handoff-required', reason: 'sensitive-draft' })
  })

  it('never carries draft material or a binding key into the preparation result', () => {
    const preparation = prepareDraftHandoff({ status: 'dirty', sensitivity: 'sensitive' })
    const serialized = JSON.stringify(preparation)
    expect(serialized).not.toContain('draft-body')
    expect(serialized).not.toContain('apiKey')
    expect(Object.keys(preparation).sort()).toEqual(['reason', 'status'])
  })

  it('classifies a review without touching the owner', () => {
    expect(reviewWorkspaceDraft({ status: 'clean' })).toEqual({ status: 'clean' })
    expect(reviewWorkspaceDraft({ status: 'dirty', sensitivity: 'safe' }))
      .toEqual({ status: 'blocked', probe: { status: 'dirty', sensitivity: 'safe' } })
  })
})

describe('createWorkspaceDraftGate：三态裁决（保存/丢弃/取消），不自动提交', () => {
  it('reads the live owner draft instead of a cached boolean', () => {
    const owner = createLiveOwner({ sensitivity: 'sensitive' })
    owner.draft = ''
    const gate = createWorkspaceDraftGate({ resolveOwner: () => owner })
    expect(gate.review('w1')).toEqual({ status: 'clean' })
    owner.draft = 'typed-into-the-real-form'
    expect(gate.review('w1')).toEqual({ status: 'blocked', probe: { status: 'dirty', sensitivity: 'sensitive' } })
    expect(gate.prepare('w1')).toEqual({ status: 'handoff-required', reason: 'sensitive-draft' })
    // 只读探针：review/prepare 绝不触发保存或丢弃
    expect(owner.save).not.toHaveBeenCalled()
    expect(owner.discard).not.toHaveBeenCalled()
    expect(owner.saved).toEqual([])
  })

  it('treats a missing owner as clean instead of inventing a draft state', async () => {
    const gate = createWorkspaceDraftGate({ resolveOwner: () => undefined })
    expect(gate.review('w1')).toEqual({ status: 'clean' })
    expect(gate.prepare('w1')).toEqual({ status: 'ready' })
    // 没有 owner 时「保存」是空操作（不抛、不持久化），但「取消」仍然保留原窗
    await expect(gate.resolve('w1', 'save')).resolves.toEqual({ status: 'proceed', resolution: 'clean' })
    await expect(gate.resolve('w1', 'cancel')).resolves.toEqual({ status: 'stay', reason: 'cancelled' })
  })

  it('keeps the window on cancel without saving or discarding the draft', async () => {
    const owner = createLiveOwner({ sensitivity: 'sensitive' })
    const gate = createWorkspaceDraftGate({ resolveOwner: () => owner })
    await expect(gate.resolve('w1', 'cancel')).resolves.toEqual({ status: 'stay', reason: 'cancelled' })
    expect(owner.save).not.toHaveBeenCalled()
    expect(owner.discard).not.toHaveBeenCalled()
    expect(owner.draft).toBe('draft-body')
  })

  it('saves only through the owner callback and reports failure without losing the draft', async () => {
    const ok = createLiveOwner()
    await expect(createWorkspaceDraftGate({ resolveOwner: () => ok }).resolve('w1', 'save'))
      .resolves.toEqual({ status: 'proceed', resolution: 'saved' })
    expect(ok.saved).toEqual(['draft-body'])
    expect(ok.discard).not.toHaveBeenCalled()

    const failing = createLiveOwner({ failSave: true })
    const resolution = await createWorkspaceDraftGate({ resolveOwner: () => failing }).resolve('w1', 'save')
    expect(resolution).toEqual({ status: 'stay', reason: 'save-failed' })
    expect(JSON.stringify(resolution)).not.toContain('private failure payload')
    expect(failing.draft).toBe('draft-body')
    expect(failing.discard).not.toHaveBeenCalled()
  })

  it('discards explicitly and never exposes the draft body in the resolution', async () => {
    const owner = createLiveOwner({ sensitivity: 'sensitive' })
    const gate = createWorkspaceDraftGate({ resolveOwner: () => owner })
    const resolution = await gate.resolve('w1', 'discard')
    expect(resolution).toEqual({ status: 'proceed', resolution: 'discarded' })
    expect(owner.discarded).toBe(1)
    expect(owner.save).not.toHaveBeenCalled()
    expect(JSON.stringify(resolution)).not.toContain('draft-body')
  })

  it('passes no arguments to the owner port so no binding key can leak into the gate', async () => {
    const owner = createLiveOwner()
    const gate = createWorkspaceDraftGate({ resolveOwner: () => owner })
    gate.review('w1')
    gate.prepare('w1')
    await gate.resolve('w1', 'save')
    expect(owner.probe).toHaveBeenCalledWith()
    expect(owner.save).toHaveBeenCalledWith()
    expect(owner.discard).not.toHaveBeenCalled()
  })
})

describe('runWorkspaceDraftBatch：批量关闭取消时不得部分关闭', () => {
  it('collects every decision before running any side effect, so cancel closes nothing', async () => {
    const first = createLiveOwner({ sensitivity: 'sensitive' })
    const second = createLiveOwner({ sensitivity: 'safe' })
    const owners = new Map([['w1', first], ['w2', second]])
    const order: string[] = []
    const result = await runWorkspaceDraftBatch({
      workspaceInstanceKeys: ['w1', 'w2'],
      getOwner: (key) => owners.get(key),
      decide: ({ workspaceInstanceKey }) => {
        order.push(workspaceInstanceKey)
        return workspaceInstanceKey === 'w1' ? 'save' : 'cancel'
      }
    })
    expect(result).toEqual({ status: 'aborted', reason: 'cancelled', blockedKey: 'w2' })
    // 决策阶段先跑完，任何保存/丢弃都不允许发生
    expect(order).toEqual(['w1', 'w2'])
    expect(first.save).not.toHaveBeenCalled()
    expect(second.save).not.toHaveBeenCalled()
    expect(second.discard).not.toHaveBeenCalled()
    expect(first.draft).toBe('draft-body')
    expect(second.draft).toBe('draft-body')
  })

  it('aborts the whole batch without discarding when one owner cannot be saved', async () => {
    const first = createLiveOwner()
    const second = createLiveOwner({ failSave: true })
    const owners = new Map([['w1', first], ['w2', second]])
    const result = await runWorkspaceDraftBatch({
      workspaceInstanceKeys: ['w1', 'w2'],
      getOwner: (key) => owners.get(key),
      decide: () => 'save'
    })
    expect(result).toEqual({ status: 'aborted', reason: 'save-failed', blockedKey: 'w2' })
    expect(first.saved).toEqual(['draft-body'])
    expect(second.draft).toBe('draft-body')
    expect(second.discard).not.toHaveBeenCalled()
  })

  it('proceeds only when every dirty owner resolved, and skips clean owners entirely', async () => {
    const dirty = createLiveOwner({ sensitivity: 'sensitive' })
    const clean = createLiveOwner()
    clean.draft = ''
    const owners = new Map([['w1', dirty], ['w2', clean], ['w3', undefined]])
    const decisions: string[] = []
    const result = await runWorkspaceDraftBatch({
      workspaceInstanceKeys: ['w1', 'w2', 'w3'],
      getOwner: (key) => owners.get(key),
      decide: ({ workspaceInstanceKey }) => { decisions.push(workspaceInstanceKey); return 'discard' }
    })
    expect(result).toEqual({ status: 'proceed', workspaceInstanceKeys: ['w1', 'w2', 'w3'] })
    expect(decisions).toEqual(['w1'])
    expect(dirty.discarded).toBe(1)
    expect(clean.probe).toHaveBeenCalledTimes(1)
    expect(clean.save).not.toHaveBeenCalled()
    expect(clean.discard).not.toHaveBeenCalled()
  })

  it('proceeds for an empty batch without touching anything', async () => {
    const result = await runWorkspaceDraftBatch({ workspaceInstanceKeys: [], getOwner: () => undefined, decide: () => 'save' })
    expect(result).toEqual({ status: 'proceed', workspaceInstanceKeys: [] })
  })
})
