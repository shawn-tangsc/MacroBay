import type { ChannelManagementResult } from '@platform/ai/agent-platform/channels/ChannelManagementContracts'
import type { AgentWorkspaceChoice } from '@platform/ai/agent-platform/schemas/workspaceSchemas'

import type { PlatformText } from '../../../i18n/platformText'
import type { Channel } from './channelSettingsPresentation'
import { mutationFailureSentence } from './channelSettingsPresentation'

/**
 * 设置页里「跟主进程打交道」的四件小事。
 *
 * 搬出来只为一件：页面本身要留在 500 行以内。这里全是**页面级的动作**，不是组件状态机——
 * 每个函数都把「改哪几个 state」显式收进来，读代码时不需要回头找闭包。
 */
type Labels = PlatformText['settings']

/** 工作目录那一栏 → 接口要的形状（`null` 是系统默认目录，落 `{ type: 'system' }`）。 */
export function workspacePayload(workspaceId: string | null): { type: 'system' } | { type: 'user'; workspaceId: string } {
  return workspaceId === null ? { type: 'system' } : { type: 'user', workspaceId }
}

export type ChannelActionDeps = {
  labels: Labels
  setBusyId: (id: string | null) => void
  setError: (message: string | null) => void
  reload: () => Promise<void>
}

/**
 * 停用 / 删除这类动作。失败时接口是**正常返回** `{ ok: false, code }`，不抛错：
 * 不看 `ok` 就会把「没停成」显示成成功——用户库里的重复频道正靠删除这一步清。
 */
export async function runChannelAction(
  channel: Channel,
  action: () => Promise<ChannelManagementResult>,
  deps: ChannelActionDeps
): Promise<void> {
  deps.setBusyId(channel.id)
  deps.setError(null)
  try {
    const result = await action()
    if (result.ok !== true) deps.setError(mutationFailureSentence(result, deps.labels))
    await deps.reload()
  } catch {
    deps.setError(deps.labels.channelOperationFailed)
  } finally {
    deps.setBusyId(null)
  }
}

export type ChooseWorkspaceDeps = {
  labels: Labels
  setSaveError: (message: string | null) => void
  setWorkspaces: (update: (current: readonly AgentWorkspaceChoice[]) => readonly AgentWorkspaceChoice[]) => void
}

/**
 * 「选择文件夹…」：系统窗口给路径 → 主进程换成工作区编号（没有就先登记）。
 *
 * 三种结局分开：取消 → `null`（**不改当前选择**，也不退回默认值）；失败 → 一句话，同样不改；
 * 成功 → 把新工作区并进下拉并返回编号。
 */
export async function chooseWorkspaceFolder(deps: ChooseWorkspaceDeps): Promise<string | null> {
  const path = await window.platform.app.selectDirectory()
  if (path === null) return null
  const result = await window.platform.agents.ensureWorkspace(path)
  if (result.ok !== true) {
    deps.setSaveError(deps.labels.channelWorkspaceFailed)
    return null
  }
  const choice: AgentWorkspaceChoice = result.workspace
  deps.setWorkspaces((current) => (current.some((workspace) => workspace.id === choice.id) ? current : [...current, choice]))
  deps.setSaveError(null)
  return choice.id
}

/**
 * 保存凭据后**回读一次**：库里必须真的变成「已配置」。
 *
 * 「请求没报错」不等于「存进了库」。三种结果必须分开说：`true` 存上了、`false` 确定没存上、
 * `null` 读不到（读不到 ≠ 没存上）。
 */
export async function readCredentialConfigured(channelId: string): Promise<boolean | null> {
  try {
    const view = await window.platform.channels.get(channelId)
    return view?.credential.hasCredential === true && view.credential.status === 'configured'
  } catch {
    return null
  }
}
