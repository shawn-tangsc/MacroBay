import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { AgentMessageGroup } from '@platform/ui/agent-chat'
import { getScrollTopAfterPrepend, isNearBottom } from '../agentMessageScroll'
import {
  getVisibleMessageEntries,
  getVisibleMessageIndices
} from '../agentMessageNavigation'
import {
  buildAgentMessageVirtualWindow,
  shouldVirtualizeAgentMessageList
} from '../agentMessageVirtualWindow'
import { updateAgentMessageVirtualHeights } from '../agentMessageVirtualMeasurements'
import {
  buildAgentMessageVirtualHeightCache,
  buildAgentMessageVirtualItems
} from '../agentMessageVirtualItems'
import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { ChatSettings } from '@platform/settings/schema/appSettings'

type UseAgentSessionMessageVirtualizationInput = {
  messages: AgentSessionMessageEntity[]
  groups: AgentMessageGroup[]
  hasOlder: boolean
  chatSettings: ChatSettings | null
}

export function useAgentSessionMessageVirtualization({
  messages,
  groups,
  hasOlder,
  chatSettings
}: UseAgentSessionMessageVirtualizationInput) {
  const shouldVirtualize = shouldVirtualizeAgentMessageList(groups.length)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const prependSnapshotRef = useRef<{ previousScrollTop: number; previousScrollHeight: number } | null>(null)
  const previousMessageCountRef = useRef(messages.length)
  const lastScrollTopRef = useRef(0)
  const messageElementRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const groupElementRefs = useRef<Record<string, HTMLElement | null>>({})
  const [activeAnchorMessageId, setActiveAnchorMessageId] = useState<string | null>(messages.at(-1)?.id ?? null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [virtualScrollTop, setVirtualScrollTop] = useState(0)
  const [virtualViewportHeight, setVirtualViewportHeight] = useState(0)
  const [measuredGroupHeights, setMeasuredGroupHeights] = useState<Record<string, number>>({})

  const virtualChatSettings = useMemo(
    () => ({
      fontSize: chatSettings?.fontSize ?? 14,
      messageStyle: chatSettings?.messageStyle ?? 'plain',
      narrowMode: chatSettings?.narrowMode ?? false
    }),
    [chatSettings?.fontSize, chatSettings?.messageStyle, chatSettings?.narrowMode]
  )
  const virtualItems = useMemo(
    () =>
      buildAgentMessageVirtualItems(
        groups,
        virtualChatSettings,
        buildAgentMessageVirtualHeightCache(groups, measuredGroupHeights, virtualChatSettings)
      ),
    [groups, measuredGroupHeights, virtualChatSettings]
  )
  const virtualWindow = useMemo(
    () =>
      buildAgentMessageVirtualWindow({
        items: virtualItems,
        viewportHeight: virtualViewportHeight,
        scrollTop: virtualScrollTop,
        measuredHeightsById: measuredGroupHeights,
        enabled: shouldVirtualize
      }),
    [measuredGroupHeights, shouldVirtualize, virtualItems, virtualScrollTop, virtualViewportHeight]
  )
  const visibleGroups = shouldVirtualize
    ? groups.slice(virtualWindow.startIndex, virtualWindow.endIndex + 1)
    : groups
  const visibleGroupIds = useMemo(() => visibleGroups.map((group) => group.id), [visibleGroups])
  const allGroupIds = useMemo(() => groups.map((group) => group.id), [groups])
  const visibleGroupsRef = useRef(visibleGroups)
  const visibleGroupIdsRef = useRef(visibleGroupIds)
  const allGroupIdsRef = useRef(allGroupIds)
  const visibleGroupIdsKey = visibleGroupIds.join('|')
  const allGroupIdsKey = allGroupIds.join('|')

  visibleGroupsRef.current = visibleGroups
  visibleGroupIdsRef.current = visibleGroupIds
  allGroupIdsRef.current = allGroupIds

  useEffect(() => {
    const element = scrollContainerRef.current
    if (!element) return
    let frame = 0

    const updateStickiness = () => {
      frame = 0
      const scrollTop = element.scrollTop
      // A user scrolling up must immediately release the bottom anchor. Without this, a small
      // upward scroll still sits inside the near-bottom threshold and the next layout effect
      // snaps the transcript back to the bottom — the visible jitter loop.
      const scrolledUp = scrollTop < lastScrollTopRef.current - 1
      if (scrolledUp) shouldStickToBottomRef.current = false
      lastScrollTopRef.current = scrollTop

      if (shouldVirtualize) {
        setVirtualScrollTop(scrollTop)
        setVirtualViewportHeight(element.clientHeight)
      }
      const nextIsNearBottom = isNearBottom({
        scrollTop,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
      })
      if (!scrolledUp && nextIsNearBottom) shouldStickToBottomRef.current = true
      setIsAtBottom(nextIsNearBottom)

      const visibleEntries = getVisibleMessageEntries(messages, messageElementRefs.current)
      const visibleIndices = getVisibleMessageIndices(
        visibleEntries.map((entry) => {
          const rect = entry.element.getBoundingClientRect()
          const containerRect = element.getBoundingClientRect()
          return {
            top: rect.top - containerRect.top,
            bottom: rect.bottom - containerRect.top
          }
        }),
        element.clientHeight
      )

      if (visibleIndices.length > 0) {
        setActiveAnchorMessageId(visibleEntries[Math.min(...visibleIndices)]?.id ?? null)
      } else if (nextIsNearBottom) {
        setActiveAnchorMessageId(messages.at(-1)?.id ?? null)
      }
    }

    const onScroll = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(updateStickiness)
    }

    updateStickiness()
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      element.removeEventListener('scroll', onScroll)
    }
  }, [messages, shouldVirtualize])

  useLayoutEffect(() => {
    const element = scrollContainerRef.current
    if (!element) return

    setVirtualScrollTop((current) => (current === element.scrollTop ? current : element.scrollTop))
    setVirtualViewportHeight((current) => (current === element.clientHeight ? current : element.clientHeight))
  }, [groups.length, shouldVirtualize])

  useLayoutEffect(() => {
    const nextHeightsById = Object.fromEntries(
      visibleGroupsRef.current.map((group) => [group.id, groupElementRefs.current[group.id]?.offsetHeight ?? 0])
    )

    setMeasuredGroupHeights((current) =>
      updateAgentMessageVirtualHeights({
        currentHeights: current,
        validIds: allGroupIdsRef.current,
        nextHeightsById
      })
    )
  }, [allGroupIdsKey, visibleGroupIdsKey])

  useEffect(() => {
    const element = scrollContainerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      setVirtualScrollTop((current) => (current === element.scrollTop ? current : element.scrollTop))
      setVirtualViewportHeight((current) => (current === element.clientHeight ? current : element.clientHeight))
      setMeasuredGroupHeights((current) =>
        updateAgentMessageVirtualHeights({
          currentHeights: current,
          validIds: allGroupIdsRef.current,
          nextHeightsById: Object.fromEntries(
            visibleGroupIdsRef.current.map((id) => [id, groupElementRefs.current[id]?.offsetHeight ?? 0])
          )
        })
      )
    })

    observer.observe(element)
    for (const groupId of visibleGroupIdsRef.current) {
      const groupElement = groupElementRefs.current[groupId]
      if (groupElement) observer.observe(groupElement)
    }

    return () => {
      observer.disconnect()
    }
  }, [allGroupIdsKey, visibleGroupIdsKey])

  useLayoutEffect(() => {
    const element = scrollContainerRef.current
    if (!element) return

    const previousMessageCount = previousMessageCountRef.current
    const isPrependingOlderMessages = messages.length > previousMessageCount && hasOlder

    if (isPrependingOlderMessages && prependSnapshotRef.current) {
      element.scrollTop = getScrollTopAfterPrepend({
        previousScrollTop: prependSnapshotRef.current.previousScrollTop,
        previousScrollHeight: prependSnapshotRef.current.previousScrollHeight,
        nextScrollHeight: element.scrollHeight
      })
      prependSnapshotRef.current = null
    } else if (shouldStickToBottomRef.current) {
      element.scrollTop = element.scrollHeight
    }

    previousMessageCountRef.current = messages.length
  }, [hasOlder, messages])

  useEffect(() => {
    if (messages.length > 0 && activeAnchorMessageId === null) {
      setActiveAnchorMessageId(messages.at(-1)?.id ?? null)
    }
  }, [activeAnchorMessageId, messages])

  function capturePrependSnapshot(): void {
    const element = scrollContainerRef.current
    if (!element) return
    prependSnapshotRef.current = {
      previousScrollTop: element.scrollTop,
      previousScrollHeight: element.scrollHeight
    }
  }

  return {
    shouldVirtualize,
    scrollContainerRef,
    shouldStickToBottomRef,
    messageElementRefs,
    groupElementRefs,
    activeAnchorMessageId,
    setActiveAnchorMessageId,
    isAtBottom,
    setIsAtBottom,
    measuredGroupHeights,
    virtualItems,
    virtualWindow,
    visibleGroups,
    capturePrependSnapshot
  }
}
