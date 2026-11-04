import { useCallback, useState } from 'react'

import { openConversation } from '../../navigation/openConversation'

import type { Channel } from './channelSettingsPresentation'

/**
 * 频道行里的「查看会话」：这条频道绑过的会话属于哪个助手，点一下怎么跳过去。
 *
 * 为什么单独一个模块：页面自己已经贴着体积上限，而这一段既不依赖页面状态、也只有一个职责——
 * 「哪些频道有会话 / 点一下跳到哪」。
 *
 * 两条口径（Chief 2026-11-05 定）：
 * - **只在真的绑定过会话时给入口**。没会话时给一个点了跳到空列表的按钮，比不给更糟；
 * - **读者显式点一下才切助手**。手机来消息就自动改当前助手，会把正在干别的事的读者挪走。
 *
 * 读不到会话（IPC 失败）按「没有」处理：宁可不给入口，也不给一个点了会跳错的按钮。
 */
export function useChannelConversationEntry(input: {
  /** 跳失败时页面显示的那一句话（键由调用方解析，这里不写文案）。 */
  failureMessage: string
  onError: (message: string) => void
}): {
  hasConversationByChannel: Readonly<Record<string, boolean>>
  readFlags: (channels: readonly Channel[]) => Promise<void>
  open: (channel: Channel) => Promise<void>
} {
  const [hasConversationByChannel, setHasConversationByChannel] = useState<Readonly<Record<string, boolean>>>({})

  const readFlags = useCallback(async (channels: readonly Channel[]): Promise<void> => {
    const entries = await Promise.all(channels.map(async (channel): Promise<readonly [string, boolean]> => {
      try {
        const conversations = await window.platform.channels.listConversations({ channelId: channel.id, limit: 50 })
        return [channel.id, conversations.some((item) => item.hasBoundSession)] as const
      } catch {
        return [channel.id, false] as const
      }
    }))
    setHasConversationByChannel(Object.fromEntries(entries))
  }, [])

  const open = useCallback(async (channel: Channel): Promise<void> => {
    const agentId = channel.agentId
    if (!agentId) return
    try {
      // 先切助手，再导航：顺序反了会先渲染出旧助手的会话列表，读者看到的是别人。
      await window.platform.agents.selectAgent(agentId)
      openConversation({ page: 'agents' })
    } catch {
      input.onError(input.failureMessage)
    }
  }, [input])

  return { hasConversationByChannel, readFlags, open }
}
