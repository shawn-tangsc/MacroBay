import type { WorkspacePreparation } from '@platform/workspace/contracts'

import { prepareWorkspaceHandoff } from './workspaceHostAdapter'

/**
 * Owner: apps/desktop-shell renderer / workspace 草稿保护（P2-02）。
 * 权威：技术设计 §6「dirty draft 不能安全交接时，保存/明确丢弃/取消；敏感草稿绝不进入平台 handoff」、
 * A-P04「草稿不静默丢失；取消保留原窗」、A-T08「敏感草稿保存/丢弃/取消，无泄漏」。
 *
 * 边界（刻意收窄）：
 *  - 本文件**不持有任何草稿正文**：owner 端口只回答「干净 / 脏 + 敏感性」，gate 的返回值里没有草稿字段，
 *    因此敏感内容（API Key 等）在结构上不可能被写进平台 handoff、快照或布局文档；
 *  - **绝不自动提交**：`review`/`prepare` 是只读探针；只有用户显式选择 save/discard 才会触碰 owner；
 *  - **批量原子**：`runWorkspaceDraftBatch` 先收齐全部裁决，任一取消 ⇒ 零副作用（不保存、不丢弃、不关闭）。
 *    保存失败可能发生在部分保存之后，但调用方只在 `proceed` 时才关闭，因此**取消/失败都绝不部分关闭**。
 *
 * 真实草稿来源由内容 owner 提供（Settings 见 `shell/settings/SettingsWorkspaceAdapter.tsx`）。
 */

export type WorkspaceDraftSensitivity = 'safe' | 'sensitive'
export type WorkspaceDirtyProbe = { status: 'dirty'; sensitivity: WorkspaceDraftSensitivity }
export type WorkspaceDraftProbe = { status: 'clean' } | WorkspaceDirtyProbe

/**
 * 内容 owner 的草稿端口。三个方法都**不接受参数**：binding 键、页面正文、草稿正文都没有入口，
 * 因此「不传 key」是类型层面的保证，而不是调用纪律。
 */
export type WorkspaceDraftOwnerPort = {
  probe: () => WorkspaceDraftProbe
  /** 复用 owner 原有的保存回调；失败必须抛出（gate 不会重试、不会吞掉失败）。 */
  save: () => Promise<void>
  /** 显式丢弃：只清 owner 自己的草稿状态，不越过 owner 去改持久化。 */
  discard: () => void
}

export type WorkspaceDraftDecision = 'save' | 'discard' | 'cancel'
export type WorkspaceDraftResolution =
  | { status: 'proceed'; resolution: 'clean' | 'saved' | 'discarded' }
  | { status: 'stay'; reason: 'cancelled' | 'save-failed' }

export type WorkspaceDraftReview = { status: 'clean' } | { status: 'blocked'; probe: WorkspaceDirtyProbe }

/** 草稿 → 平台交接前置结论：敏感草稿绝不带 handoff 数据，也绝不被自动保存。 */
export function prepareDraftHandoff(probe: WorkspaceDraftProbe): WorkspacePreparation {
  // 复用宿主适配层的唯一映射（P1-03 的四态词表），避免这里出现第二份「dirty → reason」翻译
  if (probe.status === 'clean') return prepareWorkspaceHandoff({ status: 'ready' })
  return prepareWorkspaceHandoff({ status: 'dirty', sensitive: probe.sensitivity === 'sensitive' })
}

export function reviewWorkspaceDraft(probe: WorkspaceDraftProbe): WorkspaceDraftReview {
  return probe.status === 'clean' ? { status: 'clean' } : { status: 'blocked', probe }
}

export type WorkspaceDraftGate = {
  review: (workspaceInstanceKey: string) => WorkspaceDraftReview
  prepare: (workspaceInstanceKey: string) => WorkspacePreparation
  resolve: (workspaceInstanceKey: string, decision: WorkspaceDraftDecision) => Promise<WorkspaceDraftResolution>
}

const CLEAN: WorkspaceDraftProbe = Object.freeze({ status: 'clean' })

function probeOf(owner: WorkspaceDraftOwnerPort | undefined): WorkspaceDraftProbe {
  return owner === undefined ? CLEAN : owner.probe()
}

/** 单实例三态裁决：没有 owner 就等于没有草稿（绝不伪造保护，也绝不因此静默丢弃别处草稿）。 */
export function createWorkspaceDraftGate(options: {
  resolveOwner: (workspaceInstanceKey: string) => WorkspaceDraftOwnerPort | undefined
}): WorkspaceDraftGate {
  return Object.freeze({
    review: (workspaceInstanceKey) => reviewWorkspaceDraft(probeOf(options.resolveOwner(workspaceInstanceKey))),
    prepare: (workspaceInstanceKey) => prepareDraftHandoff(probeOf(options.resolveOwner(workspaceInstanceKey))),
    async resolve(workspaceInstanceKey, decision): Promise<WorkspaceDraftResolution> {
      const owner = options.resolveOwner(workspaceInstanceKey)
      if (decision === 'cancel') return { status: 'stay', reason: 'cancelled' }
      if (owner === undefined) return { status: 'proceed', resolution: 'clean' }
      if (owner.probe().status === 'clean') return { status: 'proceed', resolution: 'clean' }
      if (decision === 'discard') {
        owner.discard()
        return { status: 'proceed', resolution: 'discarded' }
      }
      try {
        await owner.save()
        return { status: 'proceed', resolution: 'saved' }
      } catch {
        // 失败正文不回传（可能包含凭据细节），原窗与草稿保持原样
        return { status: 'stay', reason: 'save-failed' }
      }
    }
  })
}

export type WorkspaceDraftBatchResult =
  | { status: 'proceed'; workspaceInstanceKeys: readonly string[] }
  | { status: 'aborted'; reason: 'cancelled' | 'save-failed'; blockedKey: string }

/**
 * 批量关闭（关闭其他 / 关闭右侧）的**两阶段**裁决：
 *  1. 只读探针 + 收齐全部用户裁决（此阶段零副作用）；
 *  2. 任一取消 ⇒ 立即 `aborted`，保存/丢弃/关闭一个都不做。
 * 仅当全部脏 owner 都解析完成才返回 `proceed`，调用方此时才允许发出关闭命令 ⇒ 取消绝不部分关闭。
 */
export async function runWorkspaceDraftBatch(input: {
  workspaceInstanceKeys: readonly string[]
  getOwner: (workspaceInstanceKey: string) => WorkspaceDraftOwnerPort | undefined
  decide: (input: { workspaceInstanceKey: string; probe: WorkspaceDirtyProbe }) => WorkspaceDraftDecision
    | Promise<WorkspaceDraftDecision>
}): Promise<WorkspaceDraftBatchResult> {
  const dirty: Array<{ workspaceInstanceKey: string; owner: WorkspaceDraftOwnerPort; probe: WorkspaceDirtyProbe }> = []
  for (const workspaceInstanceKey of input.workspaceInstanceKeys) {
    const owner = input.getOwner(workspaceInstanceKey)
    if (owner === undefined) continue
    const probe = owner.probe()
    if (probe.status === 'dirty') dirty.push({ workspaceInstanceKey, owner, probe })
  }

  // 阶段一：全部裁决先收齐（调用顺序 = 传入顺序，便于调用方做单次提示）
  const decisions = await Promise.all(dirty.map((entry) => input.decide({
    workspaceInstanceKey: entry.workspaceInstanceKey,
    probe: entry.probe
  })))

  for (const [index, decision] of decisions.entries()) {
    if (decision === 'cancel') {
      return { status: 'aborted', reason: 'cancelled', blockedKey: dirty[index]!.workspaceInstanceKey }
    }
  }

  // 阶段二：只有全部裁决落实后才允许关闭
  for (const [index, decision] of decisions.entries()) {
    const entry = dirty[index]!
    if (decision === 'discard') {
      entry.owner.discard()
      continue
    }
    try {
      await entry.owner.save()
    } catch {
      return { status: 'aborted', reason: 'save-failed', blockedKey: entry.workspaceInstanceKey }
    }
  }

  return { status: 'proceed', workspaceInstanceKeys: [...input.workspaceInstanceKeys] }
}
