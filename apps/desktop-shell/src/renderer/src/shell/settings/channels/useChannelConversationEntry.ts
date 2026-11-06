import { useCallback, useMemo, useState } from 'react'

import { openConversation } from '../../navigation/openConversation'

import type { Channel } from './channelSettingsPresentation'

/**
 * 频道行里的「查看会话」：这条频道绑过的会话属于哪个助手，点一下怎么跳过去。
 *
 * 为什么单独一个模块：页面自己贴着体积上限，而这一段只有一个职责——「哪些频道有会话 / 点一下跳到哪」。
 *
 * 三条口径：
 * - **只在真的绑定过会话时给入口**。没会话时给一个点了跳到空列表的按钮，比不给更糟；
 * - **读者显式点一下才切助手**。手机来消息就自动改当前助手，会把正在干别的事的读者挪走（Chief 定）；
 * - **会话 id 不进渲染层**：组件只把「频道 id + 对话 id」交给主进程，主进程查表、选中、回一个
 *   `ok`／具名原因。这正是 `ChannelManagementQueryRepository` 那条「session IDs never leave this
 *   repository」的落法——要打开哪一条由主进程自己算，界面不拿内部 id 拼导航。
 *
 * 读不到会话（IPC 失败）按「没有」处理：宁可不给入口，也不给一个点了会跳错的按钮。
 */
export function useChannelConversationEntry(input: {
  /** 主进程给的原因码 → 留给读者的那一句（键由调用方解析，这里不写文案）。 */
  failureMessageFor: (code: string | null) => string
  onError: (message: string) => void
}): {
  hasConversationByChannel: Readonly<Record<string, boolean>>
  readFlags: (channels: readonly Channel[]) => Promise<void>
  open: (channel: Channel) => Promise<void>
} {
  /** channelId → 这条频道第一个绑定过会话的对话 id（对话 id 是公开的，会话 id 不是）。 */
  const [conversationIdByChannel, setConversationIdByChannel] = useState<Readonly<Record<string, string>>>({})

  const hasConversationByChannel = useMemo(
    () => Object.fromEntries(Object.entries(conversationIdByChannel).map(([channelId]) => [channelId, true])),
    [conversationIdByChannel]
  )

  const readFlags = useCallback(async (channels: readonly Channel[]): Promise<void> => {
    const entries = await Promise.all(channels.map(async (channel): Promise<readonly [string, string | null]> => {
      try {
        const conversations = await window.platform.channels.listConversations({ channelId: channel.id, limit: 50 })
        const bound = conversations.find((item) => item.hasBoundSession)
        return [channel.id, bound?.id ?? null] as const
      } catch (error) {
        // **不许把失败伪装成「这条频道没有会话」**：2026-11-06 就是这样——字段名对不上、每次调用
        // 都在主进程抛 `channel-input-invalid`，而这里静默吞掉，表现成「入口永远不出现」，
        // 用户只能对着日志里一串重复报错猜。用 error 级：应用日志只收 console.error。
        // 一句话、单参数：主进程 `console-message` 只把 message 记进 app.log，第二个对象参数会丢。
        console.error(`[channels] listConversations failed ${JSON.stringify({
          channelId: channel.id,
          reason: error instanceof Error ? error.message : String(error)
        })}`)
        return [channel.id, null] as const
      }
    }))
    setConversationIdByChannel(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] !== null)))
  }, [])

  const open = useCallback(async (channel: Channel): Promise<void> => {
    const conversationId = conversationIdByChannel[channel.id]
    if (!conversationId) return
    try {
      const result = await window.platform.channels.openConversation({ channelId: channel.id, conversationId }) as
        { ok: true } | { ok: false; code: string }
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
  }, [conversationIdByChannel, input])

  return { hasConversationByChannel, readFlags, open }
}
