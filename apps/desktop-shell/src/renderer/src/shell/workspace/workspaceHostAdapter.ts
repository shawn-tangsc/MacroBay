import type { JsonValue, PanelContainerMode, WorkspacePanelResult, WorkspacePreparation, WorkspaceSize } from '@platform/workspace/contracts'

/**
 * Owner: apps/desktop-shell renderer / workspace 面板宿主适配层。
 * 权威：P1-03 纠偏裁决 §4「close/release 边界」。
 *
 * 本文件只负责 renderer 侧两件事：
 *  1. typed port 契约（宿主对 P1-02 runtime 的唯一命令出口）；
 *  2. 内容适配器的一次性 prepare/release 语义。
 * 真正的跨窗口 prepare 信号、ACK、rollback 与 release 接线归 P1-04/P1-06；
 * 本包不把 release 接进宿主，也不宣称已验证生产跨窗口释放闭环。
 *
 * 回归：workspaceHostAdapter.test.ts、WorkspacePanelHost.test.tsx。
 */

export type WorkspacePanelHostPort = {
  activate: (input: { panelInstanceKey: string }) => Promise<WorkspacePanelResult>
  switchContainer: (input: { panelInstanceKey: string; mode: PanelContainerMode }) => Promise<WorkspacePanelResult>
  resize: (input: { panelInstanceKey: string; size: WorkspaceSize }) => Promise<WorkspacePanelResult>
  reset: (input: { panelInstanceKey: string }) => Promise<WorkspacePanelResult>
  close: (input: { panelInstanceKey: string }) => Promise<WorkspacePanelResult>
  reopen: (input: { panelInstanceKey: string }) => Promise<WorkspacePanelResult>
  /** 仅当主进程提供跨窗口转移能力时存在；缺失即视为「能力不支持」。 */
  detach?: (input: { panelInstanceKey: string }) => Promise<WorkspacePanelResult>
  /**
   * **PLAT-40**：分离面板窗的受控回停靠（复用既有 `workspace.command` 的 `redockPanel` 方法）。
   * 目标停靠模式由 Main 收敛；缺失即视为「能力不支持」（手写/注入端口不假装支持）。
   */
  redock?: (input: { panelInstanceKey: string }) => Promise<WorkspacePanelResult>
}

export type WorkspaceHandoffInput =
  | { status: 'ready'; data?: JsonValue }
  | { status: 'dirty'; sensitive?: boolean }
  | { status: 'unsupported' }

/** prepare 的四种可区分结论，全部映射到 contracts 的 WorkspacePreparation。 */
export function prepareWorkspaceHandoff(input: WorkspaceHandoffInput): WorkspacePreparation {
  if (input.status === 'ready') {
    return input.data === undefined ? { status: 'ready' } : { status: 'ready', handoff: { version: 1, data: input.data } }
  }
  if (input.status === 'unsupported') return { status: 'handoff-required', reason: 'unsupported-handoff' }
  return { status: 'handoff-required', reason: input.sensitive ? 'sensitive-draft' : 'unsaved-content' }
}

export type WorkspaceContentReleaseResult =
  | { status: 'released'; acknowledged: true }
  | { status: 'rejected'; reason: 'release-in-progress' | 'already-released' | 'release-failed' }

export type WorkspaceContentAdapter = {
  prepare: () => Promise<WorkspacePreparation>
  release: () => Promise<WorkspaceContentReleaseResult>
}

export type WorkspaceContentAdapterInput = {
  prepare: () => WorkspacePreparation | Promise<WorkspacePreparation>
  /** 真正的内容释放动作；可能异步，可能在释放过程中失败。 */
  release: () => void | Promise<unknown>
}

type ReleaseState = 'idle' | 'releasing' | 'released' | 'failed'

/**
 * 一次性异步内容释放：
 *  - 只有 await 底层 release 成功之后才返回可 ACK 的 released 结果；
 *  - 释放中再次调用 fail closed（release-in-progress）；
 *  - 释放完成后再次调用 fail closed（already-released），且不会二次触发底层释放；
 *  - 底层释放抛错时同样 fail closed（release-failed），错误正文不回传。
 */
export function createWorkspaceContentAdapter(input: WorkspaceContentAdapterInput): WorkspaceContentAdapter {
  let state: ReleaseState = 'idle'
  return Object.freeze({
    async prepare(): Promise<WorkspacePreparation> {
      return await input.prepare()
    },
    async release(): Promise<WorkspaceContentReleaseResult> {
      if (state === 'releasing') return { status: 'rejected', reason: 'release-in-progress' }
      if (state === 'released') return { status: 'rejected', reason: 'already-released' }
      if (state === 'failed') return { status: 'rejected', reason: 'release-failed' }
      state = 'releasing'
      try {
        await input.release()
        state = 'released'
        return { status: 'released', acknowledged: true }
      } catch {
        state = 'failed'
        return { status: 'rejected', reason: 'release-failed' }
      }
    }
  })
}
