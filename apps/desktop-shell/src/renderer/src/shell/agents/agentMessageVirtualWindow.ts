export type AgentMessageVirtualItem = {
  id: string
  messageCount: number
  estimatedHeight?: number
}

export type AgentMessageVirtualWindowInput = {
  items: readonly AgentMessageVirtualItem[]
  viewportHeight: number
  scrollTop: number
  measuredHeightsById: Record<string, number>
  overscanPx?: number
  enabled?: boolean
}

export type AgentMessageVirtualWindow = {
  startIndex: number
  endIndex: number
  paddingTop: number
  paddingBottom: number
  totalHeight: number
  items: AgentMessageVirtualItem[]
}

const defaultOverscanPx = 480
const virtualizeThreshold = 24
const baseGroupHeight = 96
const perMessageHeight = 56

export function shouldVirtualizeAgentMessageList(groupCount: number): boolean {
  return groupCount >= virtualizeThreshold
}

export function buildAgentMessageVirtualWindow(
  input: AgentMessageVirtualWindowInput
): AgentMessageVirtualWindow {
  const allItems = [...input.items]
  const heights = allItems.map((item) => readItemHeight(item, input.measuredHeightsById))
  const totalHeight = heights.reduce((sum, height) => sum + height, 0)
  if (allItems.length === 0) {
    return {
      startIndex: 0,
      endIndex: -1,
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight: 0,
      items: []
    }
  }

  if (input.enabled === false) {
    return {
      startIndex: 0,
      endIndex: allItems.length - 1,
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight,
      items: allItems
    }
  }

  const overscanPx = Math.max(0, input.overscanPx ?? defaultOverscanPx)
  const windowTop = Math.max(0, input.scrollTop - overscanPx)
  const windowBottom = Math.max(windowTop, input.scrollTop + Math.max(0, input.viewportHeight) + overscanPx)

  let startIndex = 0
  let currentTop = 0
  while (startIndex < heights.length && currentTop + heights[startIndex]! <= windowTop) {
    currentTop += heights[startIndex]!
    startIndex += 1
  }

  let endIndex = startIndex
  let currentBottom = currentTop
  while (endIndex < heights.length && currentBottom < windowBottom) {
    currentBottom += heights[endIndex]!
    endIndex += 1
  }

  if (endIndex <= startIndex) {
    endIndex = Math.min(heights.length, startIndex + 1)
    currentBottom = currentTop + heights[startIndex]!
  }

  return {
    startIndex,
    endIndex: endIndex - 1,
    paddingTop: currentTop,
    paddingBottom: Math.max(0, totalHeight - currentBottom),
    totalHeight,
    items: allItems.slice(startIndex, endIndex)
  }
}

export function estimateAgentMessageVirtualOffset(input: {
  items: readonly AgentMessageVirtualItem[]
  targetIndex: number
  measuredHeightsById: Record<string, number>
}): number {
  if (input.targetIndex <= 0) return 0
  return input.items.slice(0, input.targetIndex).reduce((sum, item) => {
    return sum + readItemHeight(item, input.measuredHeightsById)
  }, 0)
}

function readItemHeight(item: AgentMessageVirtualItem, measuredHeightsById: Record<string, number>): number {
  const measured = measuredHeightsById[item.id]
  if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
    return measured
  }
  if (typeof item.estimatedHeight === 'number' && Number.isFinite(item.estimatedHeight) && item.estimatedHeight > 0) {
    return item.estimatedHeight
  }
  return baseGroupHeight + Math.max(1, item.messageCount) * perMessageHeight
}
