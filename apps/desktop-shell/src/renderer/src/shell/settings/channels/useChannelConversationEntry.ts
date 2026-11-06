import { useCallback, useMemo, useState } from 'react'

import { openConversation } from '../../navigation/openConversation'

import type { Channel } from './channelSettingsPresentation'

/**
 * 频道行里的「查看会话」：这条频道绑过的会话属于哪个助手，点一下怎么跳过去。
 *
 * 为什么单独一个模块：页面自己贴着体积上限，而这一段只有一个职责——「有会话 / 读不到 / 点一下跳到哪」。
 *
 * 四条口径：
 * - **三态，不合并**：`bound`（真绑过会话）、`unknown`（这次读不到）、`none`（读到了，确实没有）。
 *   「没有」和「拿不到」必须分开（团队红线）：读失败时**入口仍然出现**，但表达成读不到，
 *   不许静默消失——2026-11-06 的报错就是这样被吞掉的，表现成「入口永远不出现」；
 * - **读者显式点一下才切助手**。手机来消息就自动改当前助手，会把正在干别的事的读者挪走（Chief 定）；
 * - **会话 id 不进渲染层**：组件只把「频道 id + 对话 id」交给主进程，主进程查表、选中、回一个
 *   `ok`／具名原因。这正是 `ChannelManagementQueryRepository` 那条「session IDs never leave this
 *   repository」的落法——要打开哪一条由主进程自己算，界面不拿内部 id 拼导航；
 * - 读失败要**留痕**（`console.error`，error 级才进 app.log），并且那一行要是**单字符串**：
 *   主进程的 `console-message` 只记 `message`，第二个对象参数会被丢掉。
 */
export type ChannelConversationEntryState =
  /** 真绑过会话：入口可点。 */
  | { state: 'bound'; conversationId: string }
  /** 这次读不到：入口在、不可点，旁边一句「读不到」。 */
  | { state: 'unknown' }
  /** 读到了，确实没有会话：不给入口（给一个点了跳空列表的按钮比不给更糟）。 */
  | { state: 'none' }

export function useChannelConversationEntry(input: {
  /** 主进程给的原因码 → 留给读者的那一句（键由调用方解析，这里不写文案）。 */
  failureMessageFor: (code: string | null) => string
  onError: (message: string) => void
}): {
  entryByChannel: Readonly<Record<string, ChannelConversationEntryState>>
  readFlags: (channels: readonly Channel[]) => Promise<void>
  open: (channel: Channel) => Promise<void>
  /** 读不到时点重试图标：重读这一条，成功就按读到的结果继续（有会话就打开，确实没有就落回不画）。 */
  retry: (channel: Channel) => Promise<ChannelConversationEntryState>
} {
  /** channelId → 三态之一。对话 id 是公开的，会话 id 仍不进渲染层。 */
  const [byChannel, setByChannel] = useState<Readonly<Record<string, ChannelConversationEntryState>>>({})

  const entryByChannel = useMemo(() => byChannel, [byChannel])

  const readOne = useCallback(async (channel: Channel): Promise<ChannelConversationEntryState> => {
      try {
        const conversations = await window.platform.channels.listConversations({ channelId: channel.id, limit: 50 })
        const bound = conversations.find((item) => item.hasBoundSession)
        return bound ? { state: 'bound', conversationId: bound.id } : { state: 'none' }
      } catch (error) {
        // **不许把失败伪装成「这条频道没有会话」**：2026-11-06 就是这样——字段名对不上、每次调用
        // 都在主进程抛 `channel-input-invalid`，而这里静默吞掉，表现成「入口永远不出现」。
        // 一句话、单参数：主进程 `console-message` 只把 message 记进 app.log，第二个对象参数会丢。
        console.error(`[channels] listConversations failed ${JSON.stringify({
          channelId: channel.id,
          reason: error instanceof Error ? error.message : String(error)
        })}`)
        // 读不到≠没有：入口还得在，换成重试图标（形状不同，不靠颜色）。
        return { state: 'unknown' }
      }
  }, [])

  const readFlags = useCallback(async (channels: readonly Channel[]): Promise<void> => {
    const entries = await Promise.all(channels.map(async (channel): Promise<readonly [string, ChannelConversationEntryState]> =>
      [channel.id, await readOne(channel)] as const))
    setByChannel(Object.fromEntries(entries))
  }, [readOne])

  const openBound = useCallback(async (channelId: string, conversationId: string): Promise<void> => {
    try {
      // 返回形状由 preload 声明提供，这里不写 `as {…}`（本目录有守卫：跨进程返回值不许手写形状）。
      const result = await window.platform.channels.openConversation({ channelId, conversationId })
      if (!result.ok) {
        // 具名原因直接给读者：不吞成一句通用失败，也不替它猜是哪一种。
        input.onError(input.failureMessageFor(result.code))
        return
      }
      // 主进程已经把那条会话设为当前会话，这里只负责跳页；顺序反了会先渲染旧助手的列表。
      openConversation({ page: 'agents' })
    } catch {
      input.onError(input.failureMessageFor(null))
    }
  }, [input])

  const open = useCallback(async (channel: Channel): Promise<void> => {
    const entry = byChannel[channel.id]
    if (!entry || entry.state !== 'bound') return
    await openBound(channel.id, entry.conversationId)
  }, [byChannel, openBound])

  const retry = useCallback(async (channel: Channel): Promise<ChannelConversationEntryState> => {
    const entry = await readOne(channel)
    setByChannel((current) => ({ ...current, [channel.id]: entry }))
    // 重读成功分两条路：有会话才打开；确实没有就落回「不画」（别拿空列表冒充打开）。
    if (entry.state === 'bound') await openBound(channel.id, entry.conversationId)
    return entry
  }, [openBound, readOne])

  return { entryByChannel, readFlags, open, retry }
}
