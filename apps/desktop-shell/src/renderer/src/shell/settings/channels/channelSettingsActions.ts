import type { ChannelManagementResult } from '@platform/ai/agent-platform/channels/ChannelManagementContracts'
import { CHANNEL_DISPLAY_NAME } from '@platform/channels/channelDisplayNames'
import type { PlatformText } from '../../../i18n/platformText'
import type { Channel } from './channelSettingsPresentation'
import { describeTestMessageReceipt, enableFailureSentence, mutationFailureSentence } from './channelSettingsPresentation'

/**
 * 设置页里「跟主进程打交道」的四件小事。
 *
 * 搬出来只为一件：页面本身要留在 500 行以内。这里全是**页面级的动作**，不是组件状态机——
 * 每个函数都把「改哪几个 state」显式收进来，读代码时不需要回头找闭包。
 */
type Labels = PlatformText['settings']

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

export type TestReceipt = { tone: 'muted' | 'bad'; text: string }

export type SendTestDeps = {
  labels: Labels
  language: 'zh-CN' | 'en-US'
  setTestBusyId: (id: string | null) => void
  setTestReceipts: (update: (current: Readonly<Record<string, TestReceipt>>) => Readonly<Record<string, TestReceipt>>) => void
}

/**
 * 行内「发送测试消息」：真发一次（走通道投递），回执就地替换。
 *
 * 发送期间禁用按钮；回执三态由 `describeTestMessageReceipt` 决定——**不出现「已送达」**，
 * 我们能证明的只有「通道接受了」。抛错也变成一行人话，不弹窗。
 */
export async function sendChannelTestMessage(channel: Channel, deps: SendTestDeps): Promise<void> {
  deps.setTestBusyId(channel.id)
  deps.setTestReceipts((current) => {
    const next = { ...current }
    delete next[channel.id]
    return next
  })
  try {
    const receipt = await window.platform.channels.sendTestMessage({
      channelId: channel.id,
      text: deps.labels.channelTestMessageBody
    })
    deps.setTestReceipts((current) => ({
      ...current,
      [channel.id]: describeTestMessageReceipt(receipt, deps.labels, CHANNEL_DISPLAY_NAME[channel.type][deps.language])
    }))
  } catch {
    deps.setTestReceipts((current) => ({
      ...current,
      [channel.id]: { tone: 'bad' as const, text: deps.labels.channelOperationFailedUnknown }
    }))
  } finally {
    deps.setTestBusyId(null)
  }
}

export type EnableDeps = {
  labels: Labels
  setBusyId: (id: string | null) => void
  setError: (message: string | null) => void
  setEnableFailures: (update: (current: Readonly<Record<string, string>>) => Readonly<Record<string, string>>) => void
  reload: () => Promise<void>
}

/**
 * 点启用 → 主进程用已存凭据现场检查 → 通过就开。
 * 失败时后台已经写过审计行，**界面不再重复写**；只在行内说一句人话，开关回弹。
 */
export async function enableChannelWithSelfCheck(channel: Channel, deps: EnableDeps): Promise<void> {
  deps.setBusyId(channel.id)
  deps.setError(null)
  deps.setEnableFailures((current) => {
    const next = { ...current }
    delete next[channel.id]
    return next
  })
  try {
    const result = await window.platform.channels.requestEnable({ channelId: channel.id, actorId: 'settings-user' })
    const sentence = enableFailureSentence(result, deps.labels)
    if (sentence !== null) deps.setEnableFailures((current) => ({ ...current, [channel.id]: sentence }))
    await deps.reload()
  } catch {
    deps.setError(deps.labels.channelOperationFailed)
  } finally {
    deps.setBusyId(null)
  }
}
