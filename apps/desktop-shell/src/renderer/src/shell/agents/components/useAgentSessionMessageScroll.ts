import { useCallback } from 'react'

import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import type { AgentMessageGroup } from '@platform/ui/agent-chat'
import {
  estimateAgentMessageVirtualOffset,
  type AgentMessageVirtualItem
} from '../agentMessageVirtualWindow'

type UseAgentSessionMessageScrollOptions = {
  messages: AgentSessionMessageEntity[]
  groups: AgentMessageGroup[]
  virtualItems: AgentMessageVirtualItem[]
  measuredGroupHeights: Record<string, number>
  activeAnchorMessageId: string | null
  setActiveAnchorMessageId: (messageId: string | null) => void
  setIsAtBottom: (value: boolean) => void
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  messageElementRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  shouldStickToBottomRef: React.MutableRefObject<boolean>
}

type AgentSessionMessageScrollControls = {
  navigateToRelativeMessage: (direction: 'previous' | 'next') => void
  scrollToBoundary: (boundary: 'top' | 'bottom') => void
  scrollToMessage: (messageId: string) => void
}

export function useAgentSessionMessageScroll({
  messages,
  groups,
  virtualItems,
  measuredGroupHeights,
  activeAnchorMessageId,
  setActiveAnchorMessageId,
  setIsAtBottom,
  scrollContainerRef,
  messageElementRefs,
  shouldStickToBottomRef
}: UseAgentSessionMessageScrollOptions): AgentSessionMessageScrollControls {
  const scrollToMessage = useCallback(
    (messageId: string) => {
      shouldStickToBottomRef.current = false
      setIsAtBottom(false)
      setActiveAnchorMessageId(messageId)
      const renderedElement = messageElementRefs.current[messageId]
      if (renderedElement) {
        renderedElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }

      const element = scrollContainerRef.current
      if (!element) return

      const targetGroupIndex = groups.findIndex((group) => group.messages.some((message) => message.id === messageId))
      if (targetGroupIndex < 0) return

      element.scrollTo({
        top: estimateAgentMessageVirtualOffset({
          items: virtualItems,
          targetIndex: targetGroupIndex,
          measuredHeightsById: measuredGroupHeights
        }),
        behavior: 'smooth'
      })
    },
    [
      groups,
      measuredGroupHeights,
      messageElementRefs,
      scrollContainerRef,
      setActiveAnchorMessageId,
      setIsAtBottom,
      shouldStickToBottomRef,
      virtualItems
    ]
  )

  const scrollToBoundary = useCallback(
    (boundary: 'top' | 'bottom') => {
      const element = scrollContainerRef.current
      if (!element) return

      const goingToBottom = boundary === 'bottom'
      shouldStickToBottomRef.current = goingToBottom
      setIsAtBottom(goingToBottom)
      if (goingToBottom) {
        setActiveAnchorMessageId(messages.at(-1)?.id ?? null)
      }
      element.scrollTo({
        top: goingToBottom ? element.scrollHeight : 0,
        behavior: 'smooth'
      })
    },
    [messages, scrollContainerRef, setActiveAnchorMessageId, setIsAtBottom, shouldStickToBottomRef]
  )

  const navigateToRelativeMessage = useCallback(
    (direction: 'previous' | 'next') => {
      if (messages.length === 0) return

      const fallbackIndex = direction === 'previous' ? messages.length - 1 : 0
      const currentIndex = activeAnchorMessageId
        ? messages.findIndex((message) => message.id === activeAnchorMessageId)
        : fallbackIndex
      const targetIndex = currentIndex < 0 ? fallbackIndex : currentIndex + (direction === 'previous' ? -1 : 1)
      const targetMessage = messages[targetIndex]
      if (!targetMessage) {
        scrollToBoundary(direction === 'previous' ? 'top' : 'bottom')
        return
      }

      scrollToMessage(targetMessage.id)
    },
    [activeAnchorMessageId, messages, scrollToBoundary, scrollToMessage]
  )

  return {
    navigateToRelativeMessage,
    scrollToBoundary,
    scrollToMessage
  }
}
